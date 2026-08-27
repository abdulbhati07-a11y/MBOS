// ---------------------------------------------------------------------------
// src/lib/api/dashboard/queries.ts
//
// Read side of the Dashboard (DEBT-032).
//
// There is no `GET /dashboard` endpoint: the dashboard is a composition, not a
// resource. It is assembled here from three groups of reads, each gated on a
// DIFFERENT permission — which is the whole reason this module is shaped as three
// independent "snapshots" rather than one call:
//
//   - salesSnapshot     — recent orders + order count     → sales.read
//   - inventorySnapshot — product count + stock alerts     → inventory.read
//   - businessSnapshot  — money totals, PO / supplier /     → reports.read
//                         customer aggregates
//
// `dashboard` is READ for every role, but `reports` and `purchases` are not — a
// Cashier holds neither. So the dashboard cannot be one request behind one gate
// without 403-ing wholesale for a role the matrix explicitly lets in. Splitting
// it lets `useDashboardMetrics` enable each snapshot only for a role allowed to
// read it, and lets the page render whatever survives. See the hook for the
// gating; this module is pure fetchers with no permission knowledge of its own.
//
// Every `*Cents` field is minor units (paisa under PKR). Render with
// `formatMoneyMinor`, never `formatMoney`. The all-time money totals have no
// cheap source on the list endpoints — you cannot sum every order from one page —
// so they come from the `/reports` aggregates, which the server derives across
// the whole table.
// ---------------------------------------------------------------------------

import { fetchOrders, type OrderStatus } from "../sales/queries"
import { fetchProducts, fetchStockAlerts } from "../inventory/queries"
import {
  fetchSalesSummary,
  fetchSupplierSpend,
  fetchCustomerActivity,
  PO_STATUSES,
  type POStatus,
} from "../reports/queries"

// Re-exported so the page imports every dashboard-facing type from one module.
export { PO_STATUSES }
export type { POStatus, OrderStatus }

/** How many of the most-recent orders the dashboard lists. */
export const RECENT_ORDERS_LIMIT = 5

// --- Sales snapshot (sales.read) -------------------------------------------

export interface DashboardRecentOrder {
  id: string
  orderNumber: string
  date: string
  /** The customer's current name; `null` for a walk-in sale. */
  customerName: string | null
  /** Minor units. */
  totalCents: number
  status: OrderStatus
}

export interface SalesSnapshot {
  /** Every order, not the returned page — from `pagination.total`. */
  totalOrderCount: number
  recentOrders: DashboardRecentOrder[]
}

/**
 * The orders list is newest-first server-side (`date desc, orderNumber desc`), so
 * the first page IS the recent orders — no client sort — and `pagination.total`
 * is the true order count without walking the pages.
 */
export async function fetchSalesSnapshot(
  signal?: AbortSignal,
): Promise<SalesSnapshot> {
  const res = await fetchOrders({ pageSize: RECENT_ORDERS_LIMIT }, signal)
  return {
    totalOrderCount: res.pagination.total,
    recentOrders: res.data.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      date: o.date,
      customerName: o.customerName,
      totalCents: o.totalCents,
      status: o.status,
    })),
  }
}

// --- Inventory snapshot (inventory.read) -----------------------------------

export interface InventorySnapshot {
  /** All live products (active and inactive), from `pagination.total`. */
  totalProductCount: number
  /** In stock but at or below reorder point. Disjoint from out-of-stock. */
  lowStockCount: number
  outOfStockCount: number
}

/**
 * `pageSize: 1` because only `pagination.total` is wanted from the product list —
 * the row itself is discarded. The alert counts come from `/inventory/alerts`,
 * whose two arrays are capped at 200 server-side, so a very long tail reads as
 * "at least"; never a concern at this app's scale.
 */
export async function fetchInventorySnapshot(
  signal?: AbortSignal,
): Promise<InventorySnapshot> {
  const [products, alerts] = await Promise.all([
    fetchProducts({ pageSize: 1 }, signal),
    fetchStockAlerts(signal),
  ])
  return {
    totalProductCount: products.pagination.total,
    lowStockCount: alerts.lowStock.length,
    outOfStockCount: alerts.outOfStock.length,
  }
}

// --- Business snapshot (reports.read) --------------------------------------

export interface DashboardPoStatusBucket {
  status: POStatus
  poCount: number
  /** Minor units. */
  totalCents: number
}

export interface BusinessSnapshot {
  /** Net of refunds — the answer to "what did we make". Minor units. */
  netSalesCents: number
  /** Concluded sales before refunds (Completed + Refunded). Minor units. */
  grossSalesCents: number
  /** Orders counted in the sales summary. */
  orderCount: number

  /** All four statuses, always present and in canonical order. */
  poByStatus: DashboardPoStatusBucket[]
  /** Draft + Sent — raised but not yet concluded (non-terminal). */
  openPOCount: number
  poCount: number

  supplierCount: number
  customerCount: number
}

/**
 * Three `/reports` aggregates in parallel. `pageSize: 1` on the two that paginate
 * because only their `totals` block is used here — the dashboard shows no report
 * rows. `sales-summary` does not paginate; it is a pure summary object.
 */
export async function fetchBusinessSnapshot(
  signal?: AbortSignal,
): Promise<BusinessSnapshot> {
  const [sales, suppliers, customers] = await Promise.all([
    fetchSalesSummary({}, signal),
    fetchSupplierSpend({ pageSize: 1 }, signal),
    fetchCustomerActivity({ pageSize: 1 }, signal),
  ])

  // The report returns a bucket only for statuses that occur; project it onto the
  // full status set so the breakdown always shows four rows in a stable order.
  const byStatusMap = new Map(
    suppliers.totals.byStatus.map((b) => [b.status, b]),
  )
  const poByStatus: DashboardPoStatusBucket[] = PO_STATUSES.map((status) => {
    const bucket = byStatusMap.get(status)
    return {
      status,
      poCount: bucket?.poCount ?? 0,
      totalCents: bucket?.totalCents ?? 0,
    }
  })
  const openPOCount = poByStatus
    .filter((b) => b.status === "Draft" || b.status === "Sent")
    .reduce((sum, b) => sum + b.poCount, 0)

  return {
    netSalesCents: sales.netSalesCents,
    grossSalesCents: sales.grossSalesCents,
    orderCount: sales.orderCount,
    poByStatus,
    openPOCount,
    poCount: suppliers.totals.poCount,
    supplierCount: suppliers.totals.supplierCount,
    customerCount: customers.totals.customerCount,
  }
}

// --- Query keys ------------------------------------------------------------

/**
 * Each snapshot caches under its own key so a section can be enabled, refetched
 * or invalidated on its own. They share the `["dashboard"]` root, so a single
 * `invalidateQueries({ queryKey: dashboardKeys.all })` refreshes the whole page.
 */
export const dashboardKeys = {
  all: ["dashboard"] as const,
  sales: () => [...dashboardKeys.all, "sales"] as const,
  inventory: () => [...dashboardKeys.all, "inventory"] as const,
  business: () => [...dashboardKeys.all, "business"] as const,
}
