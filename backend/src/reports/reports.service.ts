import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import {
  PaginatedEnvelope,
  paginate,
  resolvePagination,
} from '../common/dto/pagination.dto';
import { dateRange } from '../common/validation/query-filters';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ORDER_STATUSES, PAYMENT_METHODS } from '../orders/dto/order.dto';
import { PO_STATUSES } from '../purchases/dto/purchase-order.dto';
import {
  CSV_MAX_ROWS,
  CustomerActivityQueryDto,
  CustomerActivityRow,
  CustomerActivityTotals,
  InventoryValuationQueryDto,
  InventoryValuationRow,
  InventoryValuationTotals,
  PaymentBucket,
  ReportEnvelope,
  SalesReportOrdersQueryDto,
  SalesSummaryQueryDto,
  SalesSummaryResponse,
  StatusBucket,
  SupplierSpendQueryDto,
  SupplierSpendRow,
  SupplierSpendTotals,
} from './dto/report.dto';

/**
 * Orders that have concluded — the ones that count as revenue.
 *
 * `Refunded` is here alongside `Completed` on purpose: a refunded sale still
 * *happened*, and its `totalCents` is still what was rung up. The money that came
 * back is a separate figure (`refundsCents`), summed from the refund ledger, so
 * that `net = gross - refunds` holds exactly. Folding a refund into "not a sale"
 * would lose the retained part of every partial refund.
 *
 * `Pending` is excluded: a sale that has not concluded is not revenue, and its
 * total is reported on its own as `pendingCents`.
 */
const CONCLUDED_STATUSES = ['Completed', 'Refunded'] as const;

/**
 * A defensive cap on how many rows the memory-aggregated reports will fold.
 *
 * `customer-activity` and `supplier-spend` group at the database but then fold
 * refunds and names in memory, and `inventory-valuation` computes a derived total
 * over every matching product. All three are bounded by a tenant's *catalogue*
 * size — customers, suppliers, products — not by transaction volume, so at SMB
 * scale this is never approached. It exists so that a tenant who has somehow
 * accumulated far more gets a clear 422 rather than an OOM, and it is set well
 * above `CSV_MAX_ROWS` so the CSV cap is what a caller actually meets first.
 */
const REPORT_MAX_GROUPS = 50_000;

/**
 * Section 6.11 — reports.
 *
 * Every figure here is derived from the live database, and the guiding rule is
 * that the derivations must *agree with each other*: the per-customer rows sum to
 * the sales summary, the per-supplier rows sum to the spend total, gross minus
 * refunds equals net wherever all three appear. A reader who cross-checks two
 * reports and finds them inconsistent stops trusting both, so the reconciliations
 * are treated as part of the contract, not a nicety — see the per-method notes.
 *
 * None of these endpoints write, so `this.prisma.db` (the tenant-scoped client)
 * is used throughout and no `$transaction` is needed: each report is a read, and
 * a report that saw a write land halfway through would be no more or less correct
 * than one taken a moment earlier.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /* ---------------------------------------------------------------------- */
  /* Sales summary                                                          */
  /* ---------------------------------------------------------------------- */

  async salesSummary(
    query: SalesSummaryQueryDto,
  ): Promise<SalesSummaryResponse> {
    const where = this.salesWhere(query);

    // Three reads, run together: the status breakdown (which also carries the
    // subtotal/tax/gross figures), the payment breakdown over concluded orders
    // only, and the refund total for the same set of orders. They are
    // independent, so there is no reason to await them in series.
    const [byStatusRaw, byPaymentRaw, refundAgg] = await Promise.all([
      this.prisma.db.order.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
        _sum: {
          totalCents: true,
          subtotalCents: true,
          taxAmountCents: true,
        },
      }),
      this.prisma.db.order.groupBy({
        by: ['paymentMethod'],
        where: { ...where, status: { in: [...CONCLUDED_STATUSES] } },
        _count: { _all: true },
        _sum: { totalCents: true },
      }),
      this.prisma.db.refundTransaction.aggregate({
        where: { order: where },
        _sum: { amountCents: true },
      }),
    ]);

    // Index the raw groups so a status or method that produced no rows still
    // appears as an explicit zero. A breakdown with a missing row reads as
    // "unknown", not "none", and the two must not be confused on a financial
    // screen.
    const statusById = new Map(byStatusRaw.map((g) => [g.status, g]));
    const byStatus: StatusBucket[] = ORDER_STATUSES.map((status) => {
      const g = statusById.get(status);
      return {
        status,
        orderCount: g?._count._all ?? 0,
        totalCents: g?._sum.totalCents ?? 0,
      };
    });

    const paymentById = new Map(byPaymentRaw.map((g) => [g.paymentMethod, g]));
    const byPaymentMethod: PaymentBucket[] = PAYMENT_METHODS.map((method) => {
      const g = paymentById.get(method);
      return {
        paymentMethod: method,
        orderCount: g?._count._all ?? 0,
        totalCents: g?._sum.totalCents ?? 0,
      };
    });

    const concluded = byStatusRaw.filter((g) =>
      (CONCLUDED_STATUSES as readonly string[]).includes(g.status),
    );
    const sumOver = (
      groups: typeof byStatusRaw,
      pick: (g: (typeof byStatusRaw)[number]) => number | null,
    ): number => groups.reduce((acc, g) => acc + (pick(g) ?? 0), 0);

    const grossSalesCents = sumOver(concluded, (g) => g._sum.totalCents);
    const refundsCents = refundAgg._sum.amountCents ?? 0;
    const pending = statusById.get('Pending');

    return {
      dateFrom: query.dateFrom ?? null,
      dateTo: query.dateTo ?? null,
      branchId: query.branchId ?? null,

      orderCount: byStatusRaw.reduce((acc, g) => acc + g._count._all, 0),
      grossSalesCents,
      refundsCents,
      netSalesCents: grossSalesCents - refundsCents,
      pendingCents: pending?._sum.totalCents ?? 0,

      subtotalCents: sumOver(concluded, (g) => g._sum.subtotalCents),
      taxAmountCents: sumOver(concluded, (g) => g._sum.taxAmountCents),

      byStatus,
      byPaymentMethod,
    };
  }

  /* ---------------------------------------------------------------------- */
  /* Sales summary — the underlying orders                                  */
  /* ---------------------------------------------------------------------- */

  async salesOrders(
    query: SalesReportOrdersQueryDto,
  ): Promise<PaginatedEnvelope<SalesOrderReportRow>> {
    const where: Prisma.OrderWhereInput = {
      ...this.salesWhere(query),
      ...(query.status ? { status: query.status } : {}),
    };
    const page = resolvePagination(query);

    // A row-level list, so this paginates at the database — unlike the aggregate
    // reports, the row count here is transaction volume and must not be pulled
    // into memory. Ordered newest-first with `orderNumber` as the tiebreak so the
    // page boundary is stable when many orders share a timestamp.
    const [rows, total] = await Promise.all([
      this.prisma.db.order.findMany({
        where,
        select: SALES_ORDER_SELECT,
        orderBy: [{ date: 'desc' }, { orderNumber: 'desc' }],
        skip: query.format === 'csv' ? undefined : page.skip,
        take: query.format === 'csv' ? undefined : page.take,
      }),
      this.prisma.db.order.count({ where }),
    ]);

    if (query.format === 'csv' && total > CSV_MAX_ROWS) {
      throw csvTooLarge(total);
    }

    return paginate(rows.map(toSalesOrderRow), total, page);
  }

  /* ---------------------------------------------------------------------- */
  /* Inventory valuation                                                    */
  /* ---------------------------------------------------------------------- */

  async inventoryValuation(
    query: InventoryValuationQueryDto,
  ): Promise<ReportEnvelope<InventoryValuationRow, InventoryValuationTotals>> {
    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      ...(query.category ? { category: query.category } : {}),
    };

    // Valuation is `priceCents * stock`, a product of two columns that Prisma
    // cannot `_sum`, so the totals have to be computed in memory — which means
    // reading every matching product, not just the page. That is bounded by
    // catalogue size, and the whole set is walked once to build rows and totals
    // together. Soft-deleted products are excluded; inactive ones are kept,
    // because a withdrawn product still on the shelf still ties up capital.
    const products = await this.prisma.db.product.findMany({
      where,
      select: {
        id: true,
        name: true,
        sku: true,
        category: true,
        uom: true,
        stock: true,
        reorderPoint: true,
        isActive: true,
        priceCents: true,
        costCents: true,
      },
    });

    if (products.length > REPORT_MAX_GROUPS) {
      throw reportTooLarge('products', products.length);
    }

    const totals: InventoryValuationTotals = {
      productCount: products.length,
      retailValueCents: 0,
      costValueCents: 0,
      marginCents: 0,
      outOfStockCount: 0,
      lowStockCount: 0,
    };

    const rows: InventoryValuationRow[] = products.map((p) => {
      const retailValueCents = p.priceCents * p.stock;
      const costValueCents = p.costCents * p.stock;
      const marginCents = retailValueCents - costValueCents;

      totals.retailValueCents += retailValueCents;
      totals.costValueCents += costValueCents;
      totals.marginCents += marginCents;
      if (p.stock === 0) totals.outOfStockCount += 1;
      else if (p.stock <= p.reorderPoint) totals.lowStockCount += 1;

      return {
        productId: p.id,
        name: p.name,
        sku: p.sku,
        category: p.category,
        uom: p.uom,
        stock: p.stock,
        reorderPoint: p.reorderPoint,
        isActive: p.isActive,
        priceCents: p.priceCents,
        costCents: p.costCents,
        retailValueCents,
        costValueCents,
        marginCents,
      };
    });

    // Most valuable first — a valuation report is read top-down for where the
    // money is. Name is the tiebreak so the order is deterministic across pages.
    rows.sort(
      (a, b) =>
        b.retailValueCents - a.retailValueCents || a.name.localeCompare(b.name),
    );

    return this.assemble(rows, totals, query);
  }

  /* ---------------------------------------------------------------------- */
  /* Customer activity                                                      */
  /* ---------------------------------------------------------------------- */

  async customerActivity(
    query: CustomerActivityQueryDto,
  ): Promise<ReportEnvelope<CustomerActivityRow, CustomerActivityTotals>> {
    const range = dateRange(query.dateFrom, query.dateTo);
    const orderWhere: Prisma.OrderWhereInput = {
      status: { in: [...CONCLUDED_STATUSES] },
      ...(range ? { date: range } : {}),
    };

    // Grouping happens at the database (order volume is large); the per-customer
    // refund total is folded in memory from the refund ledger (refund volume is
    // small). Walk-in sales — `customerId: null` — belong to no row, so they are
    // aggregated separately and reported as `totals.walkIn`, which is what lets
    // this report reconcile against the sales summary.
    const [named, walkInAgg, refunds] = await Promise.all([
      this.prisma.db.order.groupBy({
        by: ['customerId'],
        where: { ...orderWhere, customerId: { not: null } },
        _count: { _all: true },
        _sum: { totalCents: true },
        _max: { date: true },
      }),
      this.prisma.db.order.aggregate({
        where: { ...orderWhere, customerId: null },
        _count: { _all: true },
        _sum: { totalCents: true },
      }),
      this.prisma.db.refundTransaction.findMany({
        where: { order: orderWhere },
        select: { amountCents: true, order: { select: { customerId: true } } },
      }),
    ]);

    if (named.length > REPORT_MAX_GROUPS) {
      throw reportTooLarge('customers', named.length);
    }

    // Fold refunds by customer id, keeping walk-in refunds (null customer) under
    // a dedicated key so they land in the walk-in total rather than vanishing.
    const WALK_IN = Symbol('walk-in');
    const refundByCustomer = new Map<string | symbol, number>();
    for (const r of refunds) {
      const key = r.order.customerId ?? WALK_IN;
      refundByCustomer.set(
        key,
        (refundByCustomer.get(key) ?? 0) + r.amountCents,
      );
    }

    // `customerId` is non-null in every group because the query filtered it so;
    // the cast documents that the `by` field is typed nullable but cannot be here.
    const ids = named.map((g) => g.customerId as string);
    const customers = await this.prisma.db.customer.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, email: true, isActive: true },
    });
    const customerById = new Map(customers.map((c) => [c.id, c]));

    const rows: CustomerActivityRow[] = named.map((g) => {
      const id = g.customerId as string;
      const c = customerById.get(id);
      const gross = g._sum.totalCents ?? 0;
      const refundsCents = refundByCustomer.get(id) ?? 0;
      return {
        customerId: id,
        // A customer row whose customer was hard-deleted keeps the id and reads
        // as unknown, rather than being dropped and unbalancing the totals.
        name: c?.name ?? '(unknown customer)',
        email: c?.email ?? '',
        isActive: c?.isActive ?? false,
        orderCount: g._count._all,
        totalSpendCents: gross - refundsCents,
        refundsCents,
        lastOrderDate: g._max.date ? g._max.date.toISOString() : null,
      };
    });

    // Highest net spend first — the report's stated default ordering.
    rows.sort(
      (a, b) =>
        b.totalSpendCents - a.totalSpendCents || a.name.localeCompare(b.name),
    );

    const walkInGross = walkInAgg._sum.totalCents ?? 0;
    const walkInRefunds = refundByCustomer.get(WALK_IN) ?? 0;
    const totals: CustomerActivityTotals = {
      customerCount: rows.length,
      buyingCustomerCount: rows.filter((r) => r.orderCount > 0).length,
      orderCount:
        rows.reduce((acc, r) => acc + r.orderCount, 0) + walkInAgg._count._all,
      totalSpendCents:
        rows.reduce((acc, r) => acc + r.totalSpendCents, 0) +
        (walkInGross - walkInRefunds),
      refundsCents:
        rows.reduce((acc, r) => acc + r.refundsCents, 0) + walkInRefunds,
      walkIn: {
        orderCount: walkInAgg._count._all,
        totalSpendCents: walkInGross - walkInRefunds,
      },
    };

    return this.assemble(rows, totals, query);
  }

  /* ---------------------------------------------------------------------- */
  /* Supplier spend                                                         */
  /* ---------------------------------------------------------------------- */

  async supplierSpend(
    query: SupplierSpendQueryDto,
  ): Promise<ReportEnvelope<SupplierSpendRow, SupplierSpendTotals>> {
    const range = dateRange(query.dateFrom, query.dateTo);
    const poWhere: Prisma.PurchaseOrderWhereInput = range
      ? { date: range }
      : {};

    // One grouped read over [supplierId, status]: the status split is what
    // separates money committed (open) from money spent (received), and folding
    // it per supplier in memory is cheaper than four separate grouped queries.
    const grouped = await this.prisma.db.purchaseOrder.groupBy({
      by: ['supplierId', 'status'],
      where: poWhere,
      _count: { _all: true },
      _sum: { totalCents: true },
      _max: { date: true },
    });

    const bySupplier = new Map<string, SupplierSpendRow>();
    const totals: SupplierSpendTotals = {
      supplierCount: 0,
      activeSupplierCount: 0,
      poCount: 0,
      totalCents: 0,
      receivedCents: 0,
      openCents: 0,
      cancelledCents: 0,
      byStatus: PO_STATUSES.map((status) => ({
        status,
        poCount: 0,
        totalCents: 0,
      })),
    };
    const statusTotal = new Map(totals.byStatus.map((b) => [b.status, b]));

    for (const g of grouped) {
      const count = g._count._all;
      const sum = g._sum.totalCents ?? 0;

      const row =
        bySupplier.get(g.supplierId) ?? emptySupplierRow(g.supplierId);
      row.poCount += count;
      row.totalCents += sum;
      if (g.status === 'Received') {
        row.receivedCount += count;
        row.receivedCents += sum;
      } else if (g.status === 'Cancelled') {
        row.cancelledCount += count;
        row.cancelledCents += sum;
      } else {
        // Draft and Sent — raised and still live.
        row.openCount += count;
        row.openCents += sum;
      }
      const last = g._max.date ? g._max.date.toISOString() : null;
      if (last && (row.lastOrderDate === null || last > row.lastOrderDate)) {
        row.lastOrderDate = last;
      }
      bySupplier.set(g.supplierId, row);

      totals.poCount += count;
      totals.totalCents += sum;
      if (g.status === 'Received') totals.receivedCents += sum;
      else if (g.status === 'Cancelled') totals.cancelledCents += sum;
      else totals.openCents += sum;
      const bucket = statusTotal.get(g.status as (typeof PO_STATUSES)[number]);
      if (bucket) {
        bucket.poCount += count;
        bucket.totalCents += sum;
      }
    }

    if (bySupplier.size > REPORT_MAX_GROUPS) {
      throw reportTooLarge('suppliers', bySupplier.size);
    }

    const suppliers = await this.prisma.db.supplier.findMany({
      where: { id: { in: [...bySupplier.keys()] } },
      select: { id: true, name: true, isActive: true },
    });
    const supplierById = new Map(suppliers.map((s) => [s.id, s]));

    const rows = [...bySupplier.values()].map((row) => {
      const s = supplierById.get(row.supplierId);
      return {
        ...row,
        name: s?.name ?? '(unknown supplier)',
        isActive: s?.isActive ?? false,
      };
    });

    rows.sort(
      (a, b) => b.totalCents - a.totalCents || a.name.localeCompare(b.name),
    );

    totals.supplierCount = rows.length;
    totals.activeSupplierCount = rows.filter((r) => r.isActive).length;

    return this.assemble(rows, totals, query);
  }

  /* ---------------------------------------------------------------------- */
  /* Shared helpers                                                         */
  /* ---------------------------------------------------------------------- */

  /** The order filter every sales report shares: date range plus branch. */
  private salesWhere(query: {
    dateFrom?: string;
    dateTo?: string;
    branchId?: string;
  }): Prisma.OrderWhereInput {
    const range = dateRange(query.dateFrom, query.dateTo);
    return {
      ...(range ? { date: range } : {}),
      ...(query.branchId ? { branchId: query.branchId } : {}),
    };
  }

  /**
   * Turns a fully-computed, sorted row set into the paginated envelope.
   *
   * The rows are already in memory (these reports aggregate the whole set to
   * compute totals), so pagination is a slice, and CSV is the whole set with the
   * row cap enforced. The `totals` block is computed over everything and is
   * therefore identical on every page — deliberately, because it describes the
   * filtered set, not the visible rows.
   */
  private assemble<TRow, TTotals>(
    rows: TRow[],
    totals: TTotals,
    query: { pageIndex?: number; pageSize?: number; format?: string },
  ): ReportEnvelope<TRow, TTotals> {
    if (query.format === 'csv') {
      if (rows.length > CSV_MAX_ROWS) throw csvTooLarge(rows.length);
      return {
        data: rows,
        pagination: {
          pageIndex: 0,
          pageSize: rows.length,
          pageCount: rows.length > 0 ? 1 : 0,
          total: rows.length,
        },
        totals,
      };
    }

    const page = resolvePagination(query);
    const slice = rows.slice(page.skip, page.skip + page.take);
    const envelope = paginate(slice, rows.length, page);
    return { ...envelope, totals };
  }
}

/* ------------------------------------------------------------------------ */
/* Row shaping                                                              */
/* ------------------------------------------------------------------------ */

const SALES_ORDER_SELECT = {
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
  customer: { select: { name: true } },
  _count: { select: { lines: true } },
} as const;

type SalesOrderSelectRow = {
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
  customer: { name: string } | null;
  _count: { lines: number };
};

/**
 * A row of `GET /reports/sales-summary/orders`.
 *
 * Deliberately its own shape rather than the full `OrderResponse`: this feeds a
 * report table, which wants the buyer's name and an item count and does not want
 * the lines. `customerName` follows the customer's current name for the same
 * reason it does on `OrderResponse` — a renamed customer is the same customer.
 */
export interface SalesOrderReportRow {
  id: string;
  orderNumber: string;
  date: string;
  branchId: string;
  customerId: string | null;
  customerName: string | null;
  lineCount: number;
  paymentMethod: string;
  status: string;
  taxRateBps: number;
  subtotalCents: number;
  taxAmountCents: number;
  totalCents: number;
}

function toSalesOrderRow(row: SalesOrderSelectRow): SalesOrderReportRow {
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    date: row.date.toISOString(),
    branchId: row.branchId,
    customerId: row.customerId,
    customerName: row.customer?.name ?? null,
    lineCount: row._count.lines,
    paymentMethod: row.paymentMethod,
    status: row.status,
    taxRateBps: row.taxRateBps,
    subtotalCents: row.subtotalCents,
    taxAmountCents: row.taxAmountCents,
    totalCents: row.totalCents,
  };
}

/** A supplier-spend row before its name and active flag are joined in. */
function emptySupplierRow(supplierId: string): SupplierSpendRow {
  return {
    supplierId,
    name: '',
    isActive: false,
    poCount: 0,
    totalCents: 0,
    receivedCount: 0,
    receivedCents: 0,
    openCount: 0,
    openCents: 0,
    cancelledCount: 0,
    cancelledCents: 0,
    lastOrderDate: null,
  };
}

/* ------------------------------------------------------------------------ */
/* Errors                                                                   */
/* ------------------------------------------------------------------------ */

function csvTooLarge(rowCount: number): UnprocessableEntityException {
  return new UnprocessableEntityException(
    `This export is ${rowCount.toLocaleString()} rows, over the ` +
      `${CSV_MAX_ROWS.toLocaleString()}-row limit for a single CSV. Narrow it ` +
      'with a date range or other filter and export again. The limit exists so ' +
      'a truncated file can never be mistaken for a complete one.',
  );
}

function reportTooLarge(
  noun: string,
  count: number,
): UnprocessableEntityException {
  return new UnprocessableEntityException(
    `This report spans ${count.toLocaleString()} ${noun}, more than it can ` +
      'aggregate in one request. Filter it down — by category or date range — ' +
      'and try again.',
  );
}
