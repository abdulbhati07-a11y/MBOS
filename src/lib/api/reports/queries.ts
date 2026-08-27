// ---------------------------------------------------------------------------
// src/lib/api/reports/queries.ts
//
// Read side of Section 6.11 — reports. Five endpoints, all gated on
// `reports.read`, all derived server-side from the live database.
//
// This is the seam that replaces what the Reports page used to compute in the
// browser from `OrdersContext` / `ProductsContext` and the `MOCK_*` arrays. The
// move matters beyond "use real data": the numbers are now derived once, on the
// server, against the whole table rather than the page's slice — so two people
// reading the same report see the same figure, and a report reconciles against
// the records it summarises (see the backend's `reports.service.ts` for the
// invariants it upholds — rows sum to totals, gross − refunds = net, walk-in
// sales reported explicitly rather than dropped).
//
// Every `*Cents` field is **minor units** (paisa under PKR). Render with
// `formatMoneyMinor`, never `formatMoney` — see `src/lib/format/currency.ts`.
// The `Cents` suffix is a known misnomer carried from Section 5.10 (DEBT-023).
// ---------------------------------------------------------------------------

import { api } from "../client"
import type { PaginatedEnvelope } from "../types"
import type { OrderStatus, PaymentMethod } from "../sales/queries"

/**
 * Purchase-order statuses, mirrored from
 * `backend/src/purchases/dto/purchase-order.dto.ts`. Used to type the
 * supplier-spend status breakdown. There is no purchases read module on the
 * frontend yet, so this is the one place the set is named client-side; keep it
 * in step with the backend constant.
 */
export const PO_STATUSES = ["Draft", "Sent", "Received", "Cancelled"] as const
export type POStatus = (typeof PO_STATUSES)[number]

/**
 * The row-plus-totals envelope the four list reports return.
 *
 * It is exactly the shared `PaginatedEnvelope` with a `totals` block bolted on,
 * which is deliberate: the `DataTable` binds to `data` / `pagination` as it does
 * everywhere else, and `totals` is purely additive. `totals` describes the whole
 * filtered set, not the visible page — so it is identical on every page and must
 * not be recomputed from `data`.
 */
export type ReportEnvelope<TRow, TTotals> = PaginatedEnvelope<TRow> & {
  totals: TTotals
}

// --- Sales summary (GET /reports/sales-summary) ----------------------------

/** One row of the by-status breakdown. Present for every status, including zero. */
export interface SalesStatusBucket {
  status: OrderStatus
  orderCount: number
  totalCents: number
}

/** One row of the by-payment-method breakdown. Present for every method. */
export interface SalesPaymentBucket {
  paymentMethod: PaymentMethod
  orderCount: number
  totalCents: number
}

/**
 * `GET /reports/sales-summary`.
 *
 * The money figures are given separately rather than collapsed into one
 * "revenue", because the readings of that word disagree:
 *   - `grossSalesCents` — concluded sales (`Completed` + `Refunded`); excludes
 *     `Pending`, which is reported on its own as `pendingCents`.
 *   - `refundsCents` — money actually returned, summed from the refund ledger,
 *     not inferred from a `Refunded` status (a refund can be partial).
 *   - `netSalesCents` — gross minus refunds. The answer to "what did we make".
 *
 * `grossSalesCents + pendingCents` accounts for every order the filter matched.
 */
export interface SalesSummary {
  dateFrom: string | null
  dateTo: string | null
  branchId: string | null
  orderCount: number
  grossSalesCents: number
  refundsCents: number
  netSalesCents: number
  pendingCents: number
  /** Sums over the same concluded orders as `grossSalesCents`. */
  subtotalCents: number
  taxAmountCents: number
  byStatus: SalesStatusBucket[]
  byPaymentMethod: SalesPaymentBucket[]
}

// --- Sales orders (GET /reports/sales-summary/orders) ----------------------

/**
 * A row of the filtered order list behind the summary.
 *
 * `customerName` is the customer's **current** name (`null` for a walk-in),
 * joined server-side — not the receipt snapshot an order line carries.
 */
export interface SalesOrderRow {
  id: string
  orderNumber: string
  date: string
  branchId: string
  customerId: string | null
  customerName: string | null
  lineCount: number
  paymentMethod: string
  status: OrderStatus
  taxRateBps: number
  subtotalCents: number
  taxAmountCents: number
  totalCents: number
}

// --- Inventory valuation (GET /reports/inventory-valuation) ----------------

/** A row of `GET /reports/inventory-valuation`. */
export interface InventoryValuationRow {
  productId: string
  name: string
  sku: string
  category: string
  uom: string
  stock: number
  reorderPoint: number
  isActive: boolean
  priceCents: number
  costCents: number
  /** `priceCents * stock` — what the shelf is worth at the selling price. */
  retailValueCents: number
  /** `costCents * stock` — what it cost to put there. */
  costValueCents: number
  /** `retailValueCents - costValueCents`. Negative when an item sells below cost. */
  marginCents: number
}

/** Totals across the whole filtered set, not the returned page. */
export interface InventoryValuationTotals {
  productCount: number
  retailValueCents: number
  costValueCents: number
  marginCents: number
  outOfStockCount: number
  /** In stock but at or below `reorderPoint`. */
  lowStockCount: number
}

// --- Customer activity (GET /reports/customer-activity) --------------------

/** A row of `GET /reports/customer-activity`. */
export interface CustomerActivityRow {
  customerId: string
  name: string
  email: string
  isActive: boolean
  orderCount: number
  /** Concluded orders, net of refunds — the same basis as `netSalesCents`. */
  totalSpendCents: number
  refundsCents: number
  lastOrderDate: string | null
}

/**
 * Sales the per-customer rows cannot hold: a POS sale with no customer selected
 * belongs to no row but is still revenue. Reported so the two reconcile.
 */
export interface WalkInActivity {
  orderCount: number
  totalSpendCents: number
}

export interface CustomerActivityTotals {
  customerCount: number
  /** Customers with at least one concluded order in range. */
  buyingCustomerCount: number
  orderCount: number
  totalSpendCents: number
  refundsCents: number
  walkIn: WalkInActivity
}

// --- Supplier spend (GET /reports/supplier-spend) --------------------------

/** A row of `GET /reports/supplier-spend`. */
export interface SupplierSpendRow {
  supplierId: string
  name: string
  isActive: boolean
  poCount: number
  /** Every purchase order raised, whatever its status. */
  totalCents: number
  /** Goods actually received — the figure that reconciles against inventory. */
  receivedCount: number
  receivedCents: number
  /** Raised and neither received nor cancelled — committed but not yet owed. */
  openCount: number
  openCents: number
  cancelledCount: number
  cancelledCents: number
  lastOrderDate: string | null
}

export interface SupplierSpendStatusBucket {
  status: POStatus
  poCount: number
  totalCents: number
}

export interface SupplierSpendTotals {
  supplierCount: number
  /** Suppliers with at least one purchase order in range. */
  activeSupplierCount: number
  poCount: number
  totalCents: number
  receivedCents: number
  openCents: number
  cancelledCents: number
  byStatus: SupplierSpendStatusBucket[]
}

// --- Query parameters ------------------------------------------------------

/** The sales filter every sales report shares: a date range plus a branch. */
export interface SalesSummaryParams {
  /** ISO date (`YYYY-MM-DD`). Omit for all time. */
  dateFrom?: string
  dateTo?: string
  branchId?: string
}

export interface SalesOrdersParams extends SalesSummaryParams {
  pageIndex?: number
  pageSize?: number
  status?: OrderStatus
}

export interface InventoryValuationParams {
  pageIndex?: number
  pageSize?: number
  /** Exact category match, mirroring `GET /products?category=`. */
  category?: string
}

export interface CustomerActivityParams {
  pageIndex?: number
  pageSize?: number
  dateFrom?: string
  dateTo?: string
}

export interface SupplierSpendParams {
  pageIndex?: number
  pageSize?: number
  dateFrom?: string
  dateTo?: string
}

// --- Query keys ------------------------------------------------------------

/**
 * All report caches hang off one `["reports"]` root, so a single
 * `invalidateQueries({ queryKey: reportKeys.all })` clears every report — which
 * is the right granularity, since a report is a read across many tables and any
 * write in the app can move one of its figures.
 */
export const reportKeys = {
  all: ["reports"] as const,
  salesSummary: (params: SalesSummaryParams) =>
    [...reportKeys.all, "sales-summary", params] as const,
  salesOrders: (params: SalesOrdersParams) =>
    [...reportKeys.all, "sales-orders", params] as const,
  inventoryValuation: (params: InventoryValuationParams) =>
    [...reportKeys.all, "inventory-valuation", params] as const,
  customerActivity: (params: CustomerActivityParams) =>
    [...reportKeys.all, "customer-activity", params] as const,
  supplierSpend: (params: SupplierSpendParams) =>
    [...reportKeys.all, "supplier-spend", params] as const,
}

// --- Fetchers --------------------------------------------------------------

export function fetchSalesSummary(
  params: SalesSummaryParams = {},
  signal?: AbortSignal,
): Promise<SalesSummary> {
  return api.get<SalesSummary>("/reports/sales-summary", {
    query: { ...params },
    signal,
  })
}

export function fetchSalesOrders(
  params: SalesOrdersParams = {},
  signal?: AbortSignal,
): Promise<PaginatedEnvelope<SalesOrderRow>> {
  return api.get<PaginatedEnvelope<SalesOrderRow>>(
    "/reports/sales-summary/orders",
    { query: { ...params }, signal },
  )
}

export function fetchInventoryValuation(
  params: InventoryValuationParams = {},
  signal?: AbortSignal,
): Promise<ReportEnvelope<InventoryValuationRow, InventoryValuationTotals>> {
  return api.get<ReportEnvelope<InventoryValuationRow, InventoryValuationTotals>>(
    "/reports/inventory-valuation",
    { query: { ...params }, signal },
  )
}

export function fetchCustomerActivity(
  params: CustomerActivityParams = {},
  signal?: AbortSignal,
): Promise<ReportEnvelope<CustomerActivityRow, CustomerActivityTotals>> {
  return api.get<ReportEnvelope<CustomerActivityRow, CustomerActivityTotals>>(
    "/reports/customer-activity",
    { query: { ...params }, signal },
  )
}

export function fetchSupplierSpend(
  params: SupplierSpendParams = {},
  signal?: AbortSignal,
): Promise<ReportEnvelope<SupplierSpendRow, SupplierSpendTotals>> {
  return api.get<ReportEnvelope<SupplierSpendRow, SupplierSpendTotals>>(
    "/reports/supplier-spend",
    { query: { ...params }, signal },
  )
}
