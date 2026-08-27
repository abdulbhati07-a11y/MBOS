import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import {
  IsOptionalDateQuery,
  MAX_SEARCH_LENGTH,
} from '../../common/validation/query-filters';
import { ORDER_STATUSES, PAYMENT_METHODS } from '../../orders/dto/order.dto';
import { PO_STATUSES } from '../../purchases/dto/purchase-order.dto';

/**
 * Section 6.11 — reports. Every endpoint requires `reports.read` and every number
 * is derived from the database, never from a client-supplied total.
 *
 * Reports are the one part of the API that is *only* derived. Nothing here
 * writes, so there is no BR-03 concern and no audit trail to keep — but there is
 * a subtler obligation in its place: a report must not quietly disagree with the
 * records it summarises. Two consequences run through this file.
 *
 *   1. **Nothing is dropped silently.** Where a filter or a grouping would
 *      exclude rows that still contribute to a total — walk-in sales have no
 *      customer, a CSV export can exceed the row cap — the excluded amount is
 *      either reported alongside or the request is refused. A report whose parts
 *      do not add up to its whole is worse than no report, because it still looks
 *      authoritative.
 *   2. **Refunds are subtracted, not inferred from status.**
 *      `POST /orders/:id/refunds` accepts a partial `amountCents` and still flips
 *      the order to `Refunded`, so status alone cannot say how much money came
 *      back. Summing `RefundTransaction.amountCents` is the only correct answer;
 *      treating a `Refunded` order as a total loss would understate revenue by
 *      the retained part of every partial refund.
 */

/* -------------------------------------------------------------------------- */
/* Shared query shapes                                                        */
/* -------------------------------------------------------------------------- */

/**
 * `?format=csv` on the list-type reports (Section 6.11).
 *
 * `json` is accepted explicitly as well as being the default, so a client can
 * pass the parameter straight through from a UI toggle without special-casing
 * the off state.
 */
export const REPORT_FORMATS = ['json', 'csv'] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

/**
 * Rows a single CSV export will produce before the request is refused.
 *
 * A CSV that honoured `pageSize` would export one page, which is useless — the
 * point of the export is the whole set — so `format=csv` ignores pagination. That
 * makes an unbounded query the obvious hazard, and there are two ways to bound
 * it: truncate, or refuse. This refuses.
 *
 * Truncation is the wrong choice specifically here. A financial export gets
 * opened in a spreadsheet, summed, and quoted; a silently short file produces a
 * number that is wrong in a way nothing on screen reveals. A 422 naming the row
 * count and the filter to narrow costs the caller one request and cannot be
 * misread. It is the same reasoning that made Section 6.7 refuse a client-sent
 * total rather than ignore it (DEBT-025).
 */
export const CSV_MAX_ROWS = 10_000;

/**
 * The sales filter: a date range plus an optional branch.
 *
 * `branchId` is validated as a UUID but deliberately *not* checked for existence.
 * An unknown branch yields an empty report, which is the truthful answer to "what
 * did this branch sell", and a 404 would let a caller probe which branch ids
 * exist for no benefit they do not already have.
 */
export class SalesSummaryQueryDto {
  @IsOptionalDateQuery()
  dateFrom?: string;

  @IsOptionalDateQuery()
  dateTo?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;
}

/** The paginated variant, for `GET /reports/sales-summary/orders`. */
export class SalesReportOrdersQueryDto extends PaginationQueryDto {
  @IsOptionalDateQuery()
  dateFrom?: string;

  @IsOptionalDateQuery()
  dateTo?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsIn(REPORT_FORMATS)
  format?: ReportFormat;

  @IsOptional()
  @IsIn(ORDER_STATUSES)
  status?: (typeof ORDER_STATUSES)[number];
}

export class InventoryValuationQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(REPORT_FORMATS)
  format?: ReportFormat;

  /**
   * Exact category match, not a search. `?category=` mirrors
   * `GET /products?category=`, which is indexed on `[tenantId, category]`; a
   * `contains` here would drop that index on the report that reads the most rows.
   */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SEARCH_LENGTH)
  category?: string;
}

export class CustomerActivityQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(REPORT_FORMATS)
  format?: ReportFormat;

  @IsOptionalDateQuery()
  dateFrom?: string;

  @IsOptionalDateQuery()
  dateTo?: string;
}

export class SupplierSpendQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(REPORT_FORMATS)
  format?: ReportFormat;

  @IsOptionalDateQuery()
  dateFrom?: string;

  @IsOptionalDateQuery()
  dateTo?: string;
}

/* -------------------------------------------------------------------------- */
/* Response shapes                                                            */
/* -------------------------------------------------------------------------- */

/** One row of the by-status breakdown. Present for every status, including zero. */
export interface StatusBucket {
  status: (typeof ORDER_STATUSES)[number];
  orderCount: number;
  totalCents: number;
}

/** One row of the by-payment-method breakdown. Present for every method. */
export interface PaymentBucket {
  paymentMethod: (typeof PAYMENT_METHODS)[number];
  orderCount: number;
  totalCents: number;
}

/**
 * `GET /reports/sales-summary`.
 *
 * The money figures are given separately rather than collapsed into one
 * "revenue", because the readings of that word disagree and a report that quietly
 * picks one is how two people quote different numbers off the same screen:
 *
 *   - `grossSalesCents` — concluded sales, i.e. `Completed` and `Refunded`
 *     orders. Excludes `Pending`: a sale that has not concluded is not revenue.
 *   - `refundsCents` — money actually returned, summed from the refund ledger.
 *   - `netSalesCents` — gross minus refunds. The number that answers "what did we
 *     make".
 *
 * `pendingCents` is reported too, so `grossSalesCents + pendingCents` accounts
 * for every order the filter matched and nothing is left unexplained.
 */
export interface SalesSummaryResponse {
  dateFrom: string | null;
  dateTo: string | null;
  branchId: string | null;

  orderCount: number;
  grossSalesCents: number;
  refundsCents: number;
  netSalesCents: number;
  pendingCents: number;

  /** Sums over the same concluded orders as `grossSalesCents`. */
  subtotalCents: number;
  taxAmountCents: number;

  byStatus: StatusBucket[];
  byPaymentMethod: PaymentBucket[];
}

/** A row of `GET /reports/inventory-valuation`. */
export interface InventoryValuationRow {
  productId: string;
  name: string;
  sku: string;
  category: string;
  uom: string;
  stock: number;
  reorderPoint: number;
  isActive: boolean;
  priceCents: number;
  costCents: number;
  /** `priceCents * stock` — what the shelf is worth at the selling price. */
  retailValueCents: number;
  /** `costCents * stock` — what it cost to put there. */
  costValueCents: number;
  /** `retailValueCents - costValueCents`. Negative when an item sells below cost. */
  marginCents: number;
}

/**
 * Totals across the **whole filtered set**, not the returned page.
 *
 * A per-page total would change as the reader paged through, which is the kind of
 * number that ends up in a spreadsheet and then in a meeting.
 */
export interface InventoryValuationTotals {
  productCount: number;
  retailValueCents: number;
  costValueCents: number;
  marginCents: number;
  outOfStockCount: number;
  /** In stock but at or below `reorderPoint` — the same rule the alerts use. */
  lowStockCount: number;
}

/** A row of `GET /reports/customer-activity`. */
export interface CustomerActivityRow {
  customerId: string;
  name: string;
  email: string;
  isActive: boolean;
  orderCount: number;
  /** Concluded orders, net of refunds — the same basis as `netSalesCents`. */
  totalSpendCents: number;
  refundsCents: number;
  lastOrderDate: string | null;
}

/**
 * Sales the per-customer rows cannot hold.
 *
 * A POS sale with no customer selected has `customerId: null`, so it belongs to
 * no row — but it is still revenue, and a customer report whose rows sum to less
 * than the sales summary looks like a bug in whichever of the two the reader
 * trusts less. Reported explicitly so the two reconcile.
 */
export interface WalkInActivity {
  orderCount: number;
  totalSpendCents: number;
}

export interface CustomerActivityTotals {
  customerCount: number;
  /** Customers with at least one concluded order in range. */
  buyingCustomerCount: number;
  orderCount: number;
  totalSpendCents: number;
  refundsCents: number;
  walkIn: WalkInActivity;
}

/** A row of `GET /reports/supplier-spend`. */
export interface SupplierSpendRow {
  supplierId: string;
  name: string;
  isActive: boolean;
  poCount: number;
  /** Every purchase order raised, whatever its status. */
  totalCents: number;
  /**
   * Goods actually received. This is the figure with a matching stock movement
   * behind it, so it is the one that reconciles against inventory.
   */
  receivedCount: number;
  receivedCents: number;
  /**
   * Raised and neither received nor cancelled — committed, but not yet owed
   * against delivered goods.
   */
  openCount: number;
  openCents: number;
  cancelledCount: number;
  cancelledCents: number;
  lastOrderDate: string | null;
}

export interface SupplierSpendTotals {
  supplierCount: number;
  /** Suppliers with at least one purchase order in range. */
  activeSupplierCount: number;
  poCount: number;
  totalCents: number;
  receivedCents: number;
  openCents: number;
  cancelledCents: number;
  byStatus: {
    status: (typeof PO_STATUSES)[number];
    poCount: number;
    totalCents: number;
  }[];
}

/**
 * The envelope the row-plus-totals reports use.
 *
 * `data` and `pagination` are exactly the shared `PaginatedEnvelope` shape, so
 * the frontend `DataTable` binds to them as it does everywhere else and `totals`
 * is purely additive.
 */
export interface ReportEnvelope<TRow, TTotals> {
  data: TRow[];
  pagination: {
    pageIndex: number;
    pageSize: number;
    pageCount: number;
    total: number;
  };
  totals: TTotals;
}
