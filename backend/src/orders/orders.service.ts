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
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import {
  CreateOrderDto,
  CreateRefundDto,
  OrderDetailResponse,
  OrderListQueryDto,
  OrderResponse,
  OrderStatus,
  RefundResponse,
} from './dto/order.dto';

const ORDER_SELECT = {
  id: true,
  orderNumber: true,
  date: true,
  branchId: true,
  customerId: true,
  paymentMethod: true,
  status: true,
  taxRateBps: true,
  subtotalCents: true,
  taxAmountCents: true,
  totalCents: true,
  createdAt: true,
  updatedAt: true,
  // Joined so a sales list can name the buyer and say how many items were sold
  // without a request per row. Both are read live rather than snapshotted: unlike
  // the line's `productNameSnapshot`, which must not move because it is what the
  // receipt said, "whose order is this" should follow the customer's current name
  // — a renamed customer is the same customer, and a history that still shows the
  // old name reads as a different one.
  customer: { select: { name: true } },
  _count: { select: { lines: true } },
} as const;

const LINE_SELECT = {
  id: true,
  productId: true,
  productNameSnapshot: true,
  unitPriceCents: true,
  quantity: true,
  lineTotalCents: true,
} as const;

const REFUND_SELECT = {
  id: true,
  orderId: true,
  amountCents: true,
  reason: true,
  createdByUserId: true,
  createdAt: true,
} as const;

type OrderRow = {
  id: string;
  orderNumber: string;
  date: Date;
  branchId: string;
  customerId: string | null;
  paymentMethod: string;
  status: string;
  taxRateBps: number;
  subtotalCents: number;
  taxAmountCents: number;
  totalCents: number;
  createdAt: Date;
  updatedAt: Date;
  customer: { name: string } | null;
  _count: { lines: number };
};

type LineRow = {
  id: string;
  productId: string;
  productNameSnapshot: string;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
};

type RefundRow = {
  id: string;
  orderId: string;
  amountCents: number;
  reason: string;
  createdByUserId: string;
  createdAt: Date;
};

/** Frontend `MOCK_ORDERS` numbers orders `#1001`+; the API keeps that format. */
const ORDER_NUMBER_START = 1001;

/**
 * Attempts at a fresh order number before giving up. Each retry costs one failed
 * INSERT, and only a genuine concurrent create can consume one, so the loop
 * exists to survive a burst of simultaneous sales rather than to mask a bug.
 */
const ORDER_NUMBER_ATTEMPTS = 5;

/** Basis-point denominator: 10000 bps = 100%. */
const BPS_DIVISOR = 10_000;

/**
 * Section 6.7 — orders, the first module that writes money.
 *
 * The rules that shape this service, and where each comes from:
 *
 *   - **The server owns the arithmetic** (BR-05). Totals are computed from the
 *     lines and the tax rate; the DTO cannot carry them. See `computeTotals`.
 *   - **Prices are snapshotted** at creation, never read live at display time, so
 *     a later repricing cannot retroactively change what a customer was charged.
 *     Product *names* are snapshotted onto the line for the same reason (BR-10).
 *   - **Completing decrements stock in the same transaction** (FR-SALE-04, BR-02).
 *     Section 6.7's endpoint list omits this; FR-SALE-04 states it outright, so
 *     the requirement wins over the API section's silence.
 *   - **Nothing here ever rewrites a financial column** (BR-03). `updateStatus`
 *     touches `status` only, and a refund is a new `RefundTransaction` row rather
 *     than an edit to the order it reverses.
 *   - **There is no delete.** No method exists, so no route can be wired to one,
 *     and `DELETE /orders/:id` 404s on an unregistered route rather than 403ing in
 *     a way that implies the operation exists (Section 6.7).
 */
@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /** GET /orders — `?status=`, `?customerId=`, `?branchId=`, `?dateFrom=`, `?dateTo=`. */
  async list(
    query: OrderListQueryDto,
  ): Promise<PaginatedEnvelope<OrderResponse>> {
    const page = resolvePagination(query);
    const date = dateRange(query.dateFrom, query.dateTo);

    const where: Prisma.OrderWhereInput = {
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.customerId === undefined
        ? {}
        : { customerId: query.customerId }),
      ...(query.branchId === undefined ? {} : { branchId: query.branchId }),
      ...(date === undefined ? {} : { date }),
    };

    const [rows, total] = await Promise.all([
      this.prisma.db.order.findMany({
        where,
        select: ORDER_SELECT,
        // Newest first: an order list is a day's trading, read from the top.
        // `orderNumber` breaks ties because `date` defaults to `now()` and two
        // sales in the same millisecond would otherwise paginate unstably —
        // the same row could appear on two pages, or on none.
        orderBy: [{ date: 'desc' }, { orderNumber: 'desc' }],
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.db.order.count({ where }),
    ]);

    return paginate(rows.map(toOrderResponse), total, page);
  }

  /** GET /orders/:id — order with its lines and refunds. */
  async findOne(id: string): Promise<OrderDetailResponse> {
    const order = await this.findOrThrow(id);
    const [lines, refunds] = await Promise.all([
      this.prisma.db.orderLine.findMany({
        where: { orderId: id },
        select: LINE_SELECT,
      }),
      this.prisma.db.refundTransaction.findMany({
        where: { orderId: id },
        select: REFUND_SELECT,
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    return toDetailResponse(order, lines, refunds);
  }

  /**
   * POST /orders. The order is created `Pending`; stock moves on completion.
   *
   * Every referenced id is proven to belong to the caller's tenant before
   * anything is written — the scoped client makes a cross-tenant id return no row
   * rather than raising, so an unchecked FK would otherwise reach Postgres as a
   * constraint violation and surface as a 500.
   */
  async create(dto: CreateOrderDto): Promise<OrderDetailResponse> {
    await this.assertBranchUsable(dto.branchId);
    const customerId = dto.customerId ?? null;
    if (customerId !== null) await this.assertCustomerUsable(customerId);

    const taxRateBps = dto.taxRateBps ?? (await this.tenantDefaultTaxRateBps());
    const lines = await this.buildLines(dto.lines);
    const totals = computeTotals(lines, taxRateBps);

    const created = await this.createWithOrderNumber((orderNumber) =>
      this.prisma.db.order.create({
        // tenantId injected by the scope extension (see ProductsService).
        // OrderLine carries no tenantId — it is isolated through this FK.
        data: {
          orderNumber,
          branchId: dto.branchId,
          customerId,
          paymentMethod: dto.paymentMethod,
          status: 'Pending',
          taxRateBps,
          subtotalCents: totals.subtotalCents,
          taxAmountCents: totals.taxAmountCents,
          totalCents: totals.totalCents,
          lines: { create: lines },
        } as Prisma.OrderUncheckedCreateInput,
        select: ORDER_SELECT,
      }),
    );

    return this.findOne(created.id);
  }

  /**
   * PATCH /orders/:id/status — `Pending` → `Completed`.
   *
   * The stock decrement and the status write share one transaction, so a sale that
   * cannot move its goods does not post (BR-02). The order is re-read *inside* the
   * transaction because the status check is what makes this idempotent under
   * concurrency: two simultaneous completions would otherwise both pass a check
   * made outside it and decrement stock twice for one sale.
   */
  async updateStatus(id: string): Promise<OrderDetailResponse> {
    const userId = this.requireUserId();

    await this.prisma.db.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { id },
        select: { id: true, status: true, branchId: true },
      });
      if (!order) {
        throw new NotFoundException(`No order ${id} exists in this tenant.`);
      }
      if (order.status !== 'Pending') {
        throw new ConflictException(
          `Order ${id} is ${order.status} and cannot be completed. Only a ` +
            'Pending order can be completed, and a posted order is never ' +
            'reopened (BR-03).',
        );
      }

      const lines = await tx.orderLine.findMany({
        where: { orderId: id },
        select: { productId: true, quantity: true },
      });

      // Summed per product first: the same product may appear on two lines, and
      // checking each line separately would approve an order whose combined
      // quantity exceeds stock.
      const needed = new Map<string, number>();
      for (const line of lines) {
        needed.set(
          line.productId,
          (needed.get(line.productId) ?? 0) + line.quantity,
        );
      }

      const products = await tx.product.findMany({
        where: { id: { in: [...needed.keys()] } },
        select: { id: true, name: true, stock: true },
      });

      const short = products
        .filter((p) => p.stock < (needed.get(p.id) ?? 0))
        .map(
          (p) => `${p.name} (need ${needed.get(p.id) ?? 0}, have ${p.stock})`,
        );
      if (short.length > 0) {
        throw new ConflictException(
          `Order ${id} cannot be completed — insufficient stock for ` +
            `${short.join('; ')}. The order stays Pending: correct the count ` +
            'through POST /inventory/adjustments, then complete it again.',
        );
      }

      for (const [productId, quantity] of needed) {
        // `decrement` is applied by Postgres, so the arithmetic is atomic even if
        // another sale commits between the read above and this write. The returned
        // stock is therefore the true post-sale level — the pre-read value would
        // be a snapshot that had already gone stale.
        const updated = await tx.product.update({
          where: { id: productId },
          data: { stock: { decrement: quantity } },
          select: { stock: true, name: true },
        });

        // The read above cannot rule out a concurrent sale of the same goods.
        // This is the check that actually holds: it runs after the decrement and
        // rolls the whole transaction back, so stock never settles below zero.
        if (updated.stock < 0) {
          throw new ConflictException(
            `Order ${id} cannot be completed — ${updated.name} sold out while ` +
              'this order was being completed. Nothing was changed; retry once ' +
              'stock is corrected.',
          );
        }

        await tx.stockAdjustment.create({
          data: {
            branchId: order.branchId,
            productId,
            type: 'REMOVE',
            quantityDelta: -quantity,
            reasonCode: 'Sale',
            newStockLevel: updated.stock,
            createdByUserId: userId,
          } as Prisma.StockAdjustmentUncheckedCreateInput,
        });
      }

      // Financial columns are untouched. This is the write that locks them: from
      // here on `create` is the only code that has ever set them (BR-03).
      await tx.order.update({
        where: { id },
        data: { status: 'Completed' },
        select: { id: true },
      });
    });

    return this.findOne(id);
  }

  /**
   * POST /orders/:id/refund — a reversing record, never an edit (BR-03).
   *
   * Stock is deliberately not restored. A v1 refund is an order-level amount with
   * no line attribution (`RefundTransaction` has no `OrderLine` FK — Section 5.11
   * defers that to v2), so the server cannot know which goods came back or how
   * many. Inventing a quantity would corrupt the count that BR-02 exists to keep
   * honest. Goods physically returned are booked through
   * `POST /inventory/adjustments` with reason `Returned`, which is why that reason
   * code exists separately from `Sale`.
   */
  async refund(id: string, dto: CreateRefundDto): Promise<RefundResponse> {
    const userId = this.requireUserId();

    return this.prisma.db.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { id },
        select: { id: true, status: true, totalCents: true },
      });
      if (!order) {
        throw new NotFoundException(`No order ${id} exists in this tenant.`);
      }

      // A Pending order has not taken money and has not moved stock, so there is
      // nothing to reverse. Section 3's UC precondition is an order that is
      // Completed; an already-Refunded one stays refundable because Section 6.7
      // permits several partial refunds against one order.
      if (order.status === 'Pending') {
        throw new ConflictException(
          `Order ${id} is Pending and has nothing to refund. Complete it first, ` +
            'or leave it Pending if the sale did not happen.',
        );
      }

      const { _sum } = await tx.refundTransaction.aggregate({
        where: { orderId: id },
        _sum: { amountCents: true },
      });
      const alreadyRefunded = _sum.amountCents ?? 0;
      const remaining = order.totalCents - alreadyRefunded;

      // Section 6.7 allows partial and repeated refunds but does not say what
      // bounds them. Their sum is bounded by the order total: refunding more than
      // was charged is not a refund, and BR-03 leaves no way to correct it after
      // the fact.
      if (dto.amountCents > remaining) {
        throw new ConflictException(
          `Refund of ${dto.amountCents} exceeds the ${remaining} still ` +
            `refundable on order ${id} (total ${order.totalCents}, already ` +
            `refunded ${alreadyRefunded}).`,
        );
      }

      const created = await tx.refundTransaction.create({
        data: {
          orderId: id,
          amountCents: dto.amountCents,
          reason: dto.reason?.trim() ?? '',
          createdByUserId: userId,
        } as Prisma.RefundTransactionUncheckedCreateInput,
        select: REFUND_SELECT,
      });

      // Side effect named by Section 6.7. Idempotent for the second and later
      // partial refunds, which are already Refunded.
      await tx.order.update({
        where: { id },
        data: { status: 'Refunded' },
        select: { id: true },
      });

      return toRefundResponse(created);
    });
  }

  /**
   * Resolves the lines: proves every product is this tenant's, live and on sale,
   * and snapshots its price and name.
   *
   * One query for all of them rather than one per line — a 40-item basket should
   * not be 40 round trips.
   */
  private async buildLines(
    requested: readonly { productId: string; quantity: number }[],
  ): Promise<
    {
      productId: string;
      productNameSnapshot: string;
      unitPriceCents: number;
      quantity: number;
      lineTotalCents: number;
    }[]
  > {
    const ids = [...new Set(requested.map((line) => line.productId))];
    const products = await this.prisma.db.product.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true, name: true, priceCents: true, isActive: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    const missing = ids.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      // 422, not 404: the body is what is wrong, and the resource being addressed
      // (the order) is not the thing that is missing — the same reasoning as
      // UsersService.assertRoleAssignable.
      throw new UnprocessableEntityException(
        `No such product in this tenant: ${missing.join(', ')}.`,
      );
    }

    // `isActive: false` is how the products module withdraws an item from sale
    // without losing its history, so honouring it here is what makes that
    // withdrawal mean anything.
    const withdrawn = products.filter((p) => !p.isActive).map((p) => p.name);
    if (withdrawn.length > 0) {
      throw new UnprocessableEntityException(
        `These products are not on sale and cannot be ordered: ` +
          `${withdrawn.join(', ')}. Reactivate them first if this is a mistake.`,
      );
    }

    return requested.map((line) => {
      const product = byId.get(line.productId)!;
      return {
        productId: product.id,
        productNameSnapshot: product.name,
        unitPriceCents: product.priceCents,
        quantity: line.quantity,
        lineTotalCents: product.priceCents * line.quantity,
      };
    });
  }

  /**
   * Retries the insert on a duplicate order number.
   *
   * The number is derived from a count, which is exact here because orders are
   * never deleted — BR-03 forbids it and no endpoint offers it — so the sequence
   * cannot collide with a reused number. It can still collide with a *concurrent*
   * create, which is what the retry is for: the unique index is the arbiter, and
   * the loser simply counts again.
   *
   * Deriving it from the highest existing number instead would be wrong. Order
   * numbers are text, and `'#9999' > '#10000'` under string comparison, so the
   * sequence would silently stall at the ten-thousandth order.
   */
  private async createWithOrderNumber(
    insert: (orderNumber: string) => Promise<{ id: string }>,
  ): Promise<{ id: string }> {
    let lastError: unknown;

    for (let attempt = 0; attempt < ORDER_NUMBER_ATTEMPTS; attempt += 1) {
      const count = await this.prisma.db.order.count();
      try {
        return await insert(`#${ORDER_NUMBER_START + count + attempt}`);
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        lastError = error;
      }
    }

    throw new ConflictException(
      `Could not allocate an order number after ${ORDER_NUMBER_ATTEMPTS} ` +
        'attempts because other sales kept taking it. Retry the request. ' +
        `(${String(lastError)})`,
    );
  }

  /** The tenant's configured rate, or 0 when settings have never been written. */
  private async tenantDefaultTaxRateBps(): Promise<number> {
    const settings = await this.prisma.db.tenantSettings.findFirst({
      select: { defaultTaxRateBps: true },
    });
    return settings?.defaultTaxRateBps ?? 0;
  }

  private async assertBranchUsable(branchId: string): Promise<void> {
    const branch = await this.prisma.db.branch.findFirst({
      where: { id: branchId, deletedAt: null },
      select: { isActive: true },
    });
    if (!branch) {
      throw new UnprocessableEntityException(
        `No branch ${branchId} exists in this tenant.`,
      );
    }
    if (!branch.isActive) {
      throw new UnprocessableEntityException(
        `Branch ${branchId} is inactive and cannot take orders.`,
      );
    }
  }

  /**
   * An inactive customer is accepted deliberately: `isActive: false` marks a
   * dormant account, not a barred one, and refusing the sale at the till would be
   * a worse error than recording it. A soft-deleted customer is refused, because
   * the FK would point at a row the customers module treats as gone.
   */
  private async assertCustomerUsable(customerId: string): Promise<void> {
    const customer = await this.prisma.db.customer.findFirst({
      where: { id: customerId, deletedAt: null },
      select: { id: true },
    });
    if (!customer) {
      throw new UnprocessableEntityException(
        `No customer ${customerId} exists in this tenant. Omit customerId for ` +
          'a walk-in sale.',
      );
    }
  }

  private async findOrThrow(id: string): Promise<OrderRow> {
    const order = await this.prisma.db.order.findFirst({
      where: { id },
      select: ORDER_SELECT,
    });
    if (!order) {
      throw new NotFoundException(`No order ${id} exists in this tenant.`);
    }
    return order;
  }

  private requireUserId(): string {
    const userId = this.tenantContext.get()?.userId;
    if (!userId) {
      throw new Error(
        'OrdersService could not identify the caller. Stock adjustments and ' +
          'refunds are attributed to a user, so proceeding without one would ' +
          'write an unauditable financial record.',
      );
    }
    return userId;
  }
}

/**
 * BR-05 — the server's arithmetic, in integer minor units throughout.
 *
 * `Math.round` on `subtotal * bps / 10000` is the only rounding in the money path
 * and it happens once, on the tax, because a rate is a ratio and the result has to
 * land on a whole paisa: 17% of Rs 47.00 is Rs 7.99. Rounding each line instead
 * would drift, and computing this from a float rupee total would reintroduce
 * exactly the error DEBT-012 exists to prevent — `8.115 * 100` is
 * `811.4999999999999`.
 *
 * The intermediate `subtotal * bps` reaches at most 2.1e13, well inside
 * `Number.MAX_SAFE_INTEGER`, so the multiplication is exact before it is capped.
 */
export function computeTotals(
  lines: readonly { unitPriceCents: number; quantity: number }[],
  taxRateBps: number,
): { subtotalCents: number; taxAmountCents: number; totalCents: number } {
  const subtotalCents = lines.reduce(
    (sum, line) => sum + line.unitPriceCents * line.quantity,
    0,
  );
  const taxAmountCents = Math.round((subtotalCents * taxRateBps) / BPS_DIVISOR);
  const totalCents = subtotalCents + taxAmountCents;

  // int4 tops out at Rs 21,474,836.47. A 422 naming the limit beats the driver's
  // integer-overflow error, which would surface as a 500 on a valid-looking body.
  if (totalCents > MAX_MONEY_MINOR) {
    throw new UnprocessableEntityException(
      `Order total ${totalCents} exceeds the largest storable amount, ` +
        `${MAX_MONEY_MINOR}. Split the order across several transactions.`,
    );
  }

  return { subtotalCents, taxAmountCents, totalCents };
}

/**
 * Duck-typed rather than `instanceof PrismaClientKnownRequestError`: the code is
 * the documented contract, and an error crossing the extended client is not
 * guaranteed to keep its prototype.
 */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

function toOrderResponse(row: OrderRow): OrderResponse {
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    date: row.date.toISOString(),
    branchId: row.branchId,
    customerId: row.customerId,
    // `null` for a walk-in sale, which is the same thing `customerId: null` says.
    // Both are returned rather than one derived from the other so a client never
    // has to decide whether an absent name means "walk-in" or "not loaded".
    customerName: row.customer?.name ?? null,
    lineCount: row._count.lines,
    paymentMethod: row.paymentMethod,
    status: row.status as OrderStatus,
    taxRateBps: row.taxRateBps,
    subtotalCents: row.subtotalCents,
    taxAmountCents: row.taxAmountCents,
    totalCents: row.totalCents,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toRefundResponse(row: RefundRow): RefundResponse {
  return {
    id: row.id,
    orderId: row.orderId,
    amountCents: row.amountCents,
    reason: row.reason,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
  };
}

function toDetailResponse(
  order: OrderRow,
  lines: readonly LineRow[],
  refunds: readonly RefundRow[],
): OrderDetailResponse {
  return {
    ...toOrderResponse(order),
    lines: lines.map((line) => ({
      id: line.id,
      productId: line.productId,
      productName: line.productNameSnapshot,
      unitPriceCents: line.unitPriceCents,
      quantity: line.quantity,
      lineTotalCents: line.lineTotalCents,
    })),
    refunds: refunds.map(toRefundResponse),
    refundedCents: refunds.reduce((sum, r) => sum + r.amountCents, 0),
  };
}
