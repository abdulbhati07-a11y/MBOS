import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import {
  PaginatedEnvelope,
  paginate,
  resolvePagination,
} from '../common/dto/pagination.dto';
import { dateRange } from '../common/validation/query-filters';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import {
  AdjustmentListQueryDto,
  AdjustmentResponse,
  AdjustmentType,
  AlertsResponse,
  CreateAdjustmentDto,
  MAX_ALERTS,
  MAX_STOCK,
  StockAlert,
} from './dto/inventory.dto';

const ADJUSTMENT_SELECT = {
  id: true,
  productId: true,
  branchId: true,
  type: true,
  quantityDelta: true,
  reasonCode: true,
  newStockLevel: true,
  createdByUserId: true,
  createdAt: true,
  product: { select: { name: true } },
} satisfies Prisma.StockAdjustmentSelect;

type AdjustmentRow = Prisma.StockAdjustmentGetPayload<{
  select: typeof ADJUSTMENT_SELECT;
}>;

const ALERT_SELECT = {
  id: true,
  name: true,
  sku: true,
  stock: true,
  reorderPoint: true,
} satisfies Prisma.ProductSelect;

/**
 * Section 6.8 — inventory adjustments: the audited write path for
 * `Product.stock`.
 *
 * `PATCH /products/:id` cannot touch `stock` (Section 6.6), so this service and
 * Section 6.7's order completion are the only two writers, and both leave a
 * `StockAdjustment` row behind. That is BR-02: the count is never changed
 * without a record of who changed it and why.
 *
 * The three types are three different operations wearing one field:
 *
 *   - `ADD` / `REMOVE` are **relative**. They use Postgres `increment` /
 *     `decrement`, so two concurrent adjustments compose instead of one
 *     overwriting the other.
 *   - `COUNT` is **absolute** — a physical stock take. It reads the current level
 *     to derive the stored delta, then `set`s the counted value. That is
 *     last-writer-wins by design: the operator has the shelf in front of them,
 *     and their number supersedes whatever the system believed.
 *
 * PROV-BR-07 (no negative stock) is enforced here rather than trusted from the
 * client. `StockAdjustmentDialog` checks it too, but that is a UX affordance —
 * the same split Section 6.2's DEBT-002 note draws for PO transitions.
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async list(
    query: AdjustmentListQueryDto,
  ): Promise<PaginatedEnvelope<AdjustmentResponse>> {
    const page = resolvePagination(query);
    const created = dateRange(query.dateFrom, query.dateTo);
    const where: Prisma.StockAdjustmentWhereInput = {
      ...(query.productId === undefined ? {} : { productId: query.productId }),
      ...(query.branchId === undefined ? {} : { branchId: query.branchId }),
      ...(query.type === undefined ? {} : { type: query.type }),
      ...(created === undefined ? {} : { createdAt: created }),
    };

    const [rows, total] = await Promise.all([
      this.prisma.db.stockAdjustment.findMany({
        where,
        select: ADJUSTMENT_SELECT,
        // `id` breaks ties: `createdAt` defaults to now(), so a burst of
        // adjustments in one transaction can share a timestamp and page unstably.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.db.stockAdjustment.count({ where }),
    ]);

    return paginate(rows.map(toResponse), total, page);
  }

  /**
   * POST /inventory/adjustments — one transaction, always.
   *
   * The order inside it matters: the stock write happens before the audit row is
   * created, and the audit row's `newStockLevel` is taken from what the write
   * returned rather than from a value computed beforehand. A pre-computed level
   * would be a guess that a concurrent adjustment could already have invalidated.
   */
  async create(dto: CreateAdjustmentDto): Promise<AdjustmentResponse> {
    const userId = this.requireUserId();

    if (dto.type !== 'COUNT' && dto.quantityDelta === 0) {
      throw new UnprocessableEntityException(
        `A ${dto.type} of 0 changes nothing and would leave a meaningless audit ` +
          'row. Send a non-zero quantity, or type COUNT to record a stock take ' +
          'that found zero.',
      );
    }

    await this.assertBranchUsable(dto.branchId);

    return this.prisma.db.$transaction(async (tx) => {
      const product = await tx.product.findFirst({
        where: { id: dto.productId, deletedAt: null },
        select: { id: true, name: true, stock: true },
      });
      // 422 rather than 404: the addressed resource is the adjustment collection,
      // which exists — it is the body's `productId` that is wrong. Same reading as
      // `users.service.ts` takes for a bad `roleId`.
      if (!product) {
        throw new UnprocessableEntityException(
          `productId ${dto.productId} does not match a product in this tenant.`,
        );
      }

      const { storedDelta, newStock } = await (async () => {
        if (dto.type === 'COUNT') {
          const delta = dto.quantityDelta - product.stock;
          const updated = await tx.product.update({
            where: { id: product.id },
            // `set`, not `increment`: a physical count replaces the system's
            // belief rather than nudging it.
            data: { stock: dto.quantityDelta },
            select: { stock: true },
          });
          return { storedDelta: delta, newStock: updated.stock };
        }

        const magnitude = dto.quantityDelta;

        // Checked before the write so the operator sees the real numbers. The
        // post-write assertion is what actually holds under concurrency.
        if (dto.type === 'REMOVE' && product.stock < magnitude) {
          throw new ConflictException(
            `Cannot remove ${magnitude} of ${product.name} — only ` +
              `${product.stock} in stock, and stock may not go negative ` +
              '(PROV-BR-07). Record a COUNT if the shelf disagrees.',
          );
        }
        if (dto.type === 'ADD' && product.stock + magnitude > MAX_STOCK) {
          throw new UnprocessableEntityException(
            `Adding ${magnitude} would take ${product.name} past ${MAX_STOCK}, ` +
              'the largest stock level this system can store.',
          );
        }

        const updated = await tx.product.update({
          where: { id: product.id },
          data:
            dto.type === 'ADD'
              ? { stock: { increment: magnitude } }
              : { stock: { decrement: magnitude } },
          select: { stock: true },
        });

        // The pre-check cannot rule out a concurrent removal of the same goods.
        // This runs after the decrement and rolls the transaction back, so stock
        // never settles below zero however the two interleave.
        if (updated.stock < 0) {
          throw new ConflictException(
            `Cannot remove ${magnitude} of ${product.name} — it was drawn down ` +
              'while this adjustment was being applied. Nothing was changed; ' +
              'retry against the current level.',
          );
        }

        return {
          storedDelta: dto.type === 'ADD' ? magnitude : -magnitude,
          newStock: updated.stock,
        };
      })();

      const row = await tx.stockAdjustment.create({
        data: {
          branchId: dto.branchId,
          productId: dto.productId,
          type: dto.type,
          quantityDelta: storedDelta,
          reasonCode: dto.reasonCode,
          newStockLevel: newStock,
          createdByUserId: userId,
        } as Prisma.StockAdjustmentUncheckedCreateInput,
        select: ADJUSTMENT_SELECT,
      });

      return toResponse(row);
    });
  }

  /**
   * GET /inventory/alerts — the Dashboard's Inventory Health widget.
   *
   * Two buckets, deliberately disjoint: `stock = 0` is out of stock, and low
   * stock is `stock > 0 AND stock <= reorderPoint`. `products.service.ts`'s
   * `?lowStock=true` filter is the looser `stock <= reorderPoint`, which includes
   * zero — that is right for a filter and wrong for a widget that shows both
   * counts side by side, where a product in both lists would be double-reported.
   *
   * Inactive products are excluded: one that is not on sale does not need
   * reordering, and listing it turns the widget into noise the moment a tenant
   * retires a product line.
   */
  async alerts(): Promise<AlertsResponse> {
    // Field reference — the only way to compare two columns in a Prisma filter.
    // Read off the unscoped client because `fields` is generated metadata rather
    // than a query, which is how `products.service.ts` reads it too.
    const reorderPoint = this.prisma.product.fields.reorderPoint;
    const visible = { deletedAt: null, isActive: true };

    const [outOfStock, lowStock] = await Promise.all([
      this.prisma.db.product.findMany({
        where: { ...visible, stock: { lte: 0 } },
        select: ALERT_SELECT,
        orderBy: { name: 'asc' },
        take: MAX_ALERTS,
      }),
      this.prisma.db.product.findMany({
        where: { ...visible, stock: { gt: 0, lte: reorderPoint } },
        select: ALERT_SELECT,
        // Scarcest first: the widget is a worklist, so the product closest to
        // running out is the one worth showing when the cap truncates.
        orderBy: [{ stock: 'asc' }, { name: 'asc' }],
        take: MAX_ALERTS,
      }),
    ]);

    return { outOfStock, lowStock };
  }

  /**
   * A soft-deleted branch is refused: an adjustment filed against it would be
   * invisible to every branch-filtered report in Section 6.9. Inactive is not a
   * state `Branch` has.
   */
  private async assertBranchUsable(branchId: string): Promise<void> {
    const branch = await this.prisma.db.branch.findFirst({
      where: { id: branchId, deletedAt: null },
      select: { id: true },
    });
    if (!branch) {
      throw new UnprocessableEntityException(
        `branchId ${branchId} does not match a branch in this tenant.`,
      );
    }
  }

  /**
   * Every adjustment is attributed, so a missing user id is a bug rather than a
   * client error — the guard chain cannot reach a handler without one.
   */
  private requireUserId(): string {
    const userId = this.tenantContext.get()?.userId;
    if (!userId) {
      throw new NotFoundException(
        'No authenticated user in context; an adjustment cannot be attributed.',
      );
    }
    return userId;
  }
}

function toResponse(row: AdjustmentRow): AdjustmentResponse {
  return {
    id: row.id,
    productId: row.productId,
    productName: row.product.name,
    branchId: row.branchId,
    type: row.type as AdjustmentType,
    quantityDelta: row.quantityDelta,
    reasonCode: row.reasonCode,
    newStockLevel: row.newStockLevel,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
  };
}

export type { StockAlert };
