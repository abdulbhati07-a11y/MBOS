import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  PaginatedEnvelope,
  paginate,
  resolvePagination,
} from '../common/dto/pagination.dto';
import { MAX_MONEY_MINOR } from '../common/validation/money';
import { dateRange } from '../common/validation/query-filters';
import { Prisma } from '../generated/prisma/client';
import { MAX_STOCK } from '../inventory/dto/inventory.dto';
import { ExtendedPrismaClient, PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import {
  CreatePOLineDto,
  CreatePurchaseOrderDto,
  INVALID_STATUS_TRANSITION,
  PO_TRANSITIONS,
  POLineResponse,
  POStatus,
  POStatusTransitionResponse,
  PurchaseOrderDetailResponse,
  PurchaseOrderListQueryDto,
  PurchaseOrderResponse,
  UpdatePOStatusDto,
} from './dto/purchase-order.dto';

const PO_SELECT = {
  id: true,
  poNumber: true,
  date: true,
  supplierId: true,
  supplierNameSnapshot: true,
  status: true,
  subtotalCents: true,
  totalCents: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  // Joined so a PO list can show an item count without loading every line to
  // count and discard it — the same reason `ORDER_SELECT` joins `_count`.
  _count: { select: { lines: true } },
} satisfies Prisma.PurchaseOrderSelect;

const PO_LINE_SELECT = {
  id: true,
  productId: true,
  productNameSnapshot: true,
  unitCostCents: true,
  quantity: true,
  lineTotalCents: true,
} satisfies Prisma.POLineSelect;

const TRANSITION_SELECT = {
  id: true,
  fromStatus: true,
  toStatus: true,
  changedByUserId: true,
  changedAt: true,
} satisfies Prisma.POStatusTransitionSelect;

/**
 * The client Prisma hands an interactive transaction: the scoped client minus the
 * methods that cannot be nested inside one.
 *
 * Inferred from `$transaction`'s own signature rather than written as
 * `Prisma.TransactionClient`, because that alias names the **unextended** client
 * and every `tx` here comes from the tenant-scoped one. The two are not
 * assignable, and the alias would be the wrong type even if it compiled — a
 * helper typed against it could be handed a raw client that does not inject
 * `tenantId`, which is precisely the mistake the extension exists to prevent.
 */
type ScopedTransactionClient = Parameters<
  Parameters<ExtendedPrismaClient['$transaction']>[0]
>[0];

type PORow = Prisma.PurchaseOrderGetPayload<{ select: typeof PO_SELECT }>;
type POLineRow = Prisma.POLineGetPayload<{ select: typeof PO_LINE_SELECT }>;
type TransitionRow = Prisma.POStatusTransitionGetPayload<{
  select: typeof TRANSITION_SELECT;
}>;

/**
 * Attempts at a fresh PO number before giving up. Only a genuine concurrent
 * create can consume one, so the loop survives two buyers raising a PO in the
 * same moment rather than masking a bug. Mirrors `ORDER_NUMBER_ATTEMPTS`.
 */
const PO_NUMBER_ATTEMPTS = 5;

/** Digits in the per-year sequence: `PO-2026-001`. Grows past 999 on its own. */
const PO_SEQUENCE_DIGITS = 3;

/**
 * Section 6.9 — purchase orders: the inbound half of the goods ledger.
 *
 * The rules that shape this service, and where each comes from:
 *
 *   - **The server owns the arithmetic** (BR-05). `subtotalCents` and
 *     `totalCents` are computed from the lines; the DTO cannot carry them.
 *   - **Names are snapshotted** — the supplier's onto the header (Section 6.9
 *     says so explicitly), the product's onto each line (BR-10). A PO is a
 *     document that was sent, and it has to keep reading as it read when it was
 *     sent.
 *   - **Costs are not snapshotted from the catalogue.** `unitCostCents` comes
 *     from the client because it is what the supplier quoted, which Section 6.9
 *     states is independent of `Product.costCents`. This is the one place a
 *     client names money, and the reason it may.
 *   - **The state machine is enforced here, not trusted from the client**
 *     (DEBT-002). `PO_TRANSITIONS` is checked against the PO's *stored* status
 *     inside the transaction that changes it.
 *   - **Receiving moves stock** — see `applyReceipt`. Section 6.9's endpoint list
 *     does not say so, but `SYSTEM_REASON_CODES` in Section 6.8's DTO already
 *     reserves `PurchaseReceived` "written by the system when … a purchase order
 *     is received (Section 6.9)", so the audit log is built expecting it. A
 *     receipt that left stock untouched would make BR-02's ledger wrong by
 *     exactly the delivery that arrived.
 *   - **There is no delete and no financial PATCH** (BR-03, Section 6.9). No
 *     method exists for either, so no route can be wired to one.
 */
@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /** GET /purchase-orders — `?status=`, `?supplierId=`, `?dateFrom=`, `?dateTo=`. */
  async list(
    query: PurchaseOrderListQueryDto,
  ): Promise<PaginatedEnvelope<PurchaseOrderResponse>> {
    const page = resolvePagination(query);
    const date = dateRange(query.dateFrom, query.dateTo);

    const where: Prisma.PurchaseOrderWhereInput = {
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.supplierId === undefined
        ? {}
        : { supplierId: query.supplierId }),
      ...(date === undefined ? {} : { date }),
    };

    const [rows, total] = await Promise.all([
      this.prisma.db.purchaseOrder.findMany({
        where,
        select: PO_SELECT,
        // Newest first, `poNumber` breaking ties: `date` defaults to `now()`, so
        // two POs raised in the same millisecond would otherwise paginate
        // unstably — one row could appear on two pages, or on none.
        orderBy: [{ date: 'desc' }, { poNumber: 'desc' }],
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.db.purchaseOrder.count({ where }),
    ]);

    return paginate(rows.map(toPOResponse), total, page);
  }

  /** GET /purchase-orders/:id — header, lines and status history. */
  async findOne(id: string): Promise<PurchaseOrderDetailResponse> {
    const po = await this.findOrThrow(id);
    const [lines, transitions] = await Promise.all([
      this.prisma.db.pOLine.findMany({
        where: { purchaseOrderId: id },
        select: PO_LINE_SELECT,
      }),
      this.loadTransitions(id),
    ]);

    return {
      ...toPOResponse(po),
      lines: lines.map(toLineResponse),
      statusTransitions: transitions,
    };
  }

  /**
   * GET /purchase-orders/:id/transitions — the history, oldest first.
   *
   * Goes through `findOrThrow` first so an id from another tenant is a 404 on the
   * PO rather than an empty history, which would read as "this PO has never
   * moved" and quietly confirm the id exists.
   */
  async listTransitions(id: string): Promise<POStatusTransitionResponse[]> {
    await this.findOrThrow(id);
    return this.loadTransitions(id);
  }

  /**
   * POST /purchase-orders. Created `Draft`; stock moves only on receipt.
   *
   * Every referenced id is proven to belong to the caller's tenant first. The
   * scoped client makes a cross-tenant id return no row rather than raising, so
   * an unchecked FK would reach Postgres as a constraint violation and surface as
   * a 500 on what is really a 422.
   */
  async create(
    dto: CreatePurchaseOrderDto,
  ): Promise<PurchaseOrderDetailResponse> {
    const supplier = await this.resolveSupplier(dto.supplierId);
    const lines = await this.buildLines(dto.lines);
    const totals = computePOTotals(lines);

    const created = await this.createWithPONumber((poNumber) =>
      this.prisma.db.purchaseOrder.create({
        // tenantId injected by the scope extension. POLine carries no tenantId —
        // it is isolated through this FK, the same as OrderLine.
        data: {
          poNumber,
          supplierId: supplier.id,
          // Section 6.9: read from `Supplier.name` server-side, never accepted
          // from the body.
          supplierNameSnapshot: supplier.name,
          status: 'Draft',
          subtotalCents: totals.subtotalCents,
          totalCents: totals.totalCents,
          notes: dto.notes?.trim() ?? '',
          lines: { create: lines },
        } as Prisma.PurchaseOrderUncheckedCreateInput,
        select: { id: true },
      }),
    );

    return this.findOne(created.id);
  }

  /**
   * PATCH /purchase-orders/:id/status.
   *
   * The transition row is inserted before the status is updated and both share
   * one transaction, as Section 6.9 requires — a history that could be missing
   * its most recent entry is not an audit trail.
   *
   * The PO is re-read *inside* the transaction because that read is what makes
   * this safe under concurrency. Two simultaneous `Sent → Received` calls would
   * both pass a check made outside it, and each would add the delivery to stock —
   * booking goods that arrived once, twice.
   */
  async updateStatus(
    id: string,
    dto: UpdatePOStatusDto,
  ): Promise<PurchaseOrderDetailResponse> {
    const userId = this.requireUserId();

    await this.prisma.db.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findFirst({
        where: { id },
        select: { id: true, poNumber: true, status: true },
      });
      if (!po) {
        throw new NotFoundException(
          `No purchase order ${id} exists in this tenant.`,
        );
      }

      const fromStatus = po.status as POStatus;
      const allowed = PO_TRANSITIONS[fromStatus] ?? [];

      if (!allowed.includes(dto.toStatus)) {
        // Section 6.9's specified failure: 409 carrying its own code so a client
        // can tell a refused transition from any other conflict without parsing
        // prose. The message names what *is* possible, because a client that got
        // here has a stale view of the PO and needs to know the real options.
        throw new ConflictException({
          code: INVALID_STATUS_TRANSITION,
          message:
            `Purchase order ${po.poNumber} is ${fromStatus} and cannot move to ` +
            `${dto.toStatus}. ` +
            (allowed.length === 0
              ? `${fromStatus} is terminal — raise a new purchase order instead ` +
                '(BR-03 gives no path back).'
              : `Allowed from ${fromStatus}: ${allowed.join(', ')}.`),
        });
      }

      // Ordered as Section 6.9 states: history first, then the status it
      // describes. Inside one transaction the order is not observable, but it is
      // the order that stays correct if this is ever split.
      await tx.pOStatusTransition.create({
        data: {
          purchaseOrderId: id,
          fromStatus,
          toStatus: dto.toStatus,
          changedByUserId: userId,
        } as Prisma.POStatusTransitionUncheckedCreateInput,
        select: { id: true },
      });

      if (dto.toStatus === 'Received') {
        await this.applyReceipt(tx, id, po.poNumber, userId);
      }

      // `status` only. No financial column is touched here, which is what locks
      // them: `create` remains the only code that has ever set them (BR-03).
      await tx.purchaseOrder.update({
        where: { id },
        data: { status: dto.toStatus },
        select: { id: true },
      });
    });

    return this.findOne(id);
  }

  /**
   * Books a delivery into stock: one `increment` and one `StockAdjustment` per
   * product on the PO.
   *
   * Quantities are summed per product first, because the same product may appear
   * on two lines — a PO listing an item twice at two agreed costs is ordinary —
   * and adjusting per line would write two audit rows whose `newStockLevel`
   * fields both claim to be the level after the delivery.
   *
   * WHICH BRANCH. `StockAdjustment.branchId` is required and `PurchaseOrder` has
   * no branch column, so received goods are booked to the tenant's default
   * branch. Section 6.9 does not say where a delivery lands; this is the only
   * answer available without a schema change, and it is right for the
   * single-branch tenant the seed describes. Recorded as DEBT-034 — a
   * multi-branch tenant needs `PurchaseOrder.branchId`, chosen when the PO is
   * raised.
   */
  private async applyReceipt(
    tx: ScopedTransactionClient,
    purchaseOrderId: string,
    poNumber: string,
    userId: string,
  ): Promise<void> {
    const lines = await tx.pOLine.findMany({
      where: { purchaseOrderId },
      select: { productId: true, quantity: true },
    });

    const received = new Map<string, number>();
    for (const line of lines) {
      received.set(
        line.productId,
        (received.get(line.productId) ?? 0) + line.quantity,
      );
    }

    const branchId = await this.defaultBranchId(tx);

    const products = await tx.product.findMany({
      where: { id: { in: [...received.keys()] } },
      select: { id: true, name: true, stock: true },
    });

    // int4 ceiling, checked before any write so an overflowing receipt fails
    // whole rather than part-applied. Same bound Section 6.8's `ADD` enforces.
    const overflowing = products
      .filter((p) => p.stock + (received.get(p.id) ?? 0) > MAX_STOCK)
      .map((p) => `${p.name} (${p.stock} + ${received.get(p.id) ?? 0})`);
    if (overflowing.length > 0) {
      throw new UnprocessableEntityException(
        `Receiving ${poNumber} would take these past ${MAX_STOCK}, the largest ` +
          `storable stock level: ${overflowing.join('; ')}. Nothing was ` +
          'received.',
      );
    }

    for (const [productId, quantity] of received) {
      // `increment` is applied by Postgres, so the arithmetic is atomic even if
      // another receipt or sale commits between the read above and this write.
      // The returned level is therefore the true post-receipt one; the pre-read
      // value would already be stale.
      const updated = await tx.product.update({
        where: { id: productId },
        data: { stock: { increment: quantity } },
        select: { stock: true },
      });

      await tx.stockAdjustment.create({
        data: {
          branchId,
          productId,
          type: 'ADD',
          quantityDelta: quantity,
          // A system reason code (Section 6.8): no client may submit it, so
          // every row bearing it has a received PO behind it. That is what makes
          // the audit log reconcilable against the purchase ledger.
          reasonCode: 'PurchaseReceived',
          newStockLevel: updated.stock,
          createdByUserId: userId,
        } as Prisma.StockAdjustmentUncheckedCreateInput,
        select: { id: true },
      });
    }
  }

  /**
   * Resolves the lines: proves every product is this tenant's and orderable, and
   * snapshots its name against the client's agreed cost.
   *
   * One query for all of them rather than one per line — a 200-line restocking PO
   * should not be 200 round trips.
   */
  private async buildLines(requested: readonly CreatePOLineDto[]): Promise<
    {
      productId: string;
      productNameSnapshot: string;
      unitCostCents: number;
      quantity: number;
      lineTotalCents: number;
    }[]
  > {
    const ids = [...new Set(requested.map((line) => line.productId))];
    const products = await this.prisma.db.product.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true, name: true, isActive: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    const missing = ids.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      // 422, not 404: the body is what is wrong, and the resource being
      // addressed is not the thing that is missing — the same reasoning as
      // `OrdersService.buildLines`.
      throw new UnprocessableEntityException(
        `No such product in this tenant: ${missing.join(', ')}.`,
      );
    }

    // A withdrawn product is refused here as it is on an order, and the reason
    // is the same in both directions: `isActive: false` is how the catalogue
    // takes an item out of circulation, and a module that ignored it would make
    // that withdrawal mean nothing. Buying stock of something you have withdrawn
    // is far likelier to be a stale basket than a deliberate relaunch — and if it
    // is deliberate, reactivating first is one call and leaves a record.
    const withdrawn = products.filter((p) => !p.isActive).map((p) => p.name);
    if (withdrawn.length > 0) {
      throw new UnprocessableEntityException(
        `These products are withdrawn and cannot be ordered from a supplier: ` +
          `${withdrawn.join(', ')}. Reactivate them first if you are restocking ` +
          'them.',
      );
    }

    return requested.map((line) => {
      const product = byId.get(line.productId)!;
      return {
        productId: product.id,
        productNameSnapshot: product.name,
        unitCostCents: line.unitCostCents,
        quantity: line.quantity,
        lineTotalCents: line.unitCostCents * line.quantity,
      };
    });
  }

  /**
   * The supplier this PO commits to, or 422.
   *
   * An inactive supplier is refused, where `OrdersService` *accepts* an inactive
   * customer. The asymmetry is the direction of the commitment: recording a sale
   * to a dormant account is better than turning a paying customer away at the
   * till, but raising a new order *to* a supplier the tenant has deactivated is a
   * commitment to spend money with someone they stopped buying from. Reactivating
   * is one call if the deactivation was the mistake.
   */
  private async resolveSupplier(
    supplierId: string,
  ): Promise<{ id: string; name: string }> {
    const supplier = await this.prisma.db.supplier.findFirst({
      where: { id: supplierId, deletedAt: null },
      select: { id: true, name: true, isActive: true },
    });
    if (!supplier) {
      throw new UnprocessableEntityException(
        `No supplier ${supplierId} exists in this tenant.`,
      );
    }
    if (!supplier.isActive) {
      throw new UnprocessableEntityException(
        `Supplier ${supplier.name} is inactive and cannot be sent new purchase ` +
          'orders. Reactivate them first if this is a mistake.',
      );
    }
    return { id: supplier.id, name: supplier.name };
  }

  /**
   * Retries the insert on a duplicate PO number.
   *
   * `PO-2026-001`, matching the format the frontend's mock data established. The
   * sequence is per tenant *and* per calendar year, which is what the year in the
   * number is for — it restarts each January rather than counting forever.
   *
   * Derived from a count over that year's rows, which is exact because POs are
   * never deleted: Section 6.9 registers no `DELETE`, so no number is ever freed
   * and reused. It can still collide with a *concurrent* create, which is what
   * the retry handles — the unique index is the arbiter and the loser counts
   * again.
   *
   * Counted rather than read off the highest existing number, because these are
   * text: `'PO-2026-999' > 'PO-2026-1000'` under string comparison, so a
   * max-based sequence would silently stall at the thousandth PO of a year.
   */
  private async createWithPONumber(
    insert: (poNumber: string) => Promise<{ id: string }>,
  ): Promise<{ id: string }> {
    // The year is taken from the same clock that will set `date`, so a PO raised
    // seconds before midnight on 31 December cannot be numbered for a year it is
    // not dated in.
    const now = new Date();
    const year = now.getUTCFullYear();
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const nextYearStart = new Date(Date.UTC(year + 1, 0, 1));

    let lastError: unknown;

    for (let attempt = 0; attempt < PO_NUMBER_ATTEMPTS; attempt += 1) {
      const count = await this.prisma.db.purchaseOrder.count({
        where: { date: { gte: yearStart, lt: nextYearStart } },
      });
      const sequence = String(count + 1 + attempt).padStart(
        PO_SEQUENCE_DIGITS,
        '0',
      );

      try {
        return await insert(`PO-${year}-${sequence}`);
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        lastError = error;
      }
    }

    throw new ConflictException(
      `Could not allocate a purchase order number after ${PO_NUMBER_ATTEMPTS} ` +
        'attempts because other purchase orders kept taking it. Retry the ' +
        `request. (${String(lastError)})`,
    );
  }

  /**
   * The branch received goods are booked to. See `applyReceipt` on why this is
   * needed at all (DEBT-034).
   *
   * Prefers the branch flagged `isDefault`, then any active one, so a tenant
   * whose seed never set the flag still receives stock rather than failing on a
   * technicality.
   */
  private async defaultBranchId(tx: ScopedTransactionClient): Promise<string> {
    const branch = await tx.branch.findFirst({
      where: { deletedAt: null, isActive: true },
      select: { id: true },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    if (!branch) {
      throw new UnprocessableEntityException(
        'This tenant has no active branch, so there is nowhere to receive goods ' +
          'into. Create a branch through POST /settings/branches first.',
      );
    }
    return branch.id;
  }

  private async loadTransitions(
    purchaseOrderId: string,
  ): Promise<POStatusTransitionResponse[]> {
    const rows = await this.prisma.db.pOStatusTransition.findMany({
      where: { purchaseOrderId },
      select: TRANSITION_SELECT,
      // Section 6.9: ascending by `changedAt` — a history reads forwards.
      orderBy: { changedAt: 'asc' },
    });
    return rows.map(toTransitionResponse);
  }

  private async findOrThrow(id: string): Promise<PORow> {
    const po = await this.prisma.db.purchaseOrder.findFirst({
      where: { id },
      select: PO_SELECT,
    });
    if (!po) {
      throw new NotFoundException(
        `No purchase order ${id} exists in this tenant.`,
      );
    }
    return po;
  }

  private requireUserId(): string {
    const userId = this.tenantContext.get()?.userId;
    if (!userId) {
      throw new Error(
        'PurchasesService could not identify the caller. Status transitions and ' +
          'stock adjustments are attributed to a user, so proceeding without ' +
          'one would write an unauditable record.',
      );
    }
    return userId;
  }
}

/**
 * BR-05 — the server's arithmetic, in integer minor units throughout.
 *
 * There is no rounding here and nothing to round: `PurchaseOrder` has no tax
 * columns, so the total is the sum of the lines and `totalCents` equals
 * `subtotalCents`. Both are computed and stored, because both columns exist —
 * see `PurchaseOrderResponse.totalCents` and DEBT-033.
 */
export function computePOTotals(
  lines: readonly { unitCostCents: number; quantity: number }[],
): { subtotalCents: number; totalCents: number } {
  const subtotalCents = lines.reduce(
    (sum, line) => sum + line.unitCostCents * line.quantity,
    0,
  );

  // int4 tops out at Rs 21,474,836.47, and a wholesale PO in rupees can reach
  // that in a way the same business in dollars never would (see the note on
  // MAX_MONEY_MINOR). A 422 naming the limit beats the driver's integer-overflow
  // error, which would surface as a 500 on a body that looked valid.
  if (subtotalCents > MAX_MONEY_MINOR) {
    throw new UnprocessableEntityException(
      `Purchase order total ${subtotalCents} exceeds the largest storable ` +
        `amount, ${MAX_MONEY_MINOR}. Split it across several purchase orders.`,
    );
  }

  return { subtotalCents, totalCents: subtotalCents };
}

/**
 * Duck-typed rather than `instanceof PrismaClientKnownRequestError`: the code is
 * the documented contract, and an error crossing the extended client is not
 * guaranteed to keep its prototype. Same helper shape as `OrdersService`.
 */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

function toPOResponse(row: PORow): PurchaseOrderResponse {
  return {
    id: row.id,
    poNumber: row.poNumber,
    date: row.date.toISOString(),
    supplierId: row.supplierId,
    supplierName: row.supplierNameSnapshot,
    status: row.status as POStatus,
    subtotalCents: row.subtotalCents,
    totalCents: row.totalCents,
    notes: row.notes,
    lineCount: row._count.lines,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toLineResponse(row: POLineRow): POLineResponse {
  return {
    id: row.id,
    productId: row.productId,
    productName: row.productNameSnapshot,
    unitCostCents: row.unitCostCents,
    quantity: row.quantity,
    lineTotalCents: row.lineTotalCents,
  };
}

function toTransitionResponse(row: TransitionRow): POStatusTransitionResponse {
  return {
    id: row.id,
    fromStatus: row.fromStatus as POStatus,
    toStatus: row.toStatus as POStatus,
    changedByUserId: row.changedByUserId,
    changedAt: row.changedAt.toISOString(),
  };
}
