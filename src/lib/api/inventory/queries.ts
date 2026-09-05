// ---------------------------------------------------------------------------
// src/lib/api/inventory/queries.ts
//
// Read side of Sections 6.6 (products) and 6.8 (adjustments, alerts).
//
// Both live here because the Inventory page is one screen: the product table, the
// low-stock alert widget, and the adjustment history are three reads against two
// controllers, and splitting them across modules would only mean the page imports
// from two places to render one view.
//
// Every money field below is **minor units** — paisa under PKR. Render with
// `formatMoneyMinor`, never `formatMoney`. The `Cents` suffix is Section 5.10's
// naming convention and a known misnomer (DEBT-023).
// ---------------------------------------------------------------------------

import { api } from "../client"
import type { PaginatedEnvelope } from "../types"

// --- Products (6.6) --------------------------------------------------------

export interface Product {
  id: string
  name: string
  sku: string
  category: string
  /** Minor units. */
  priceCents: number
  /** Minor units. */
  costCents: number
  stock: number
  reorderPoint: number
  /** Unit of measure, e.g. `pcs`. */
  uom: string
  isActive: boolean
  /**
   * `stock <= reorderPoint`, computed server-side.
   *
   * Use it rather than recomputing the comparison in a component: the threshold
   * belongs to the API, and a client that derives it will disagree the moment the
   * rule changes.
   */
  isLowStock: boolean
  createdAt: string
  updatedAt: string
}

export interface ProductListParams {
  pageIndex?: number
  pageSize?: number
  isActive?: boolean
  /** Matches name or SKU. */
  search?: string
  category?: string
  /** `true` → at or below reorder point; `false` → strictly above it. */
  lowStock?: boolean
}

export const productKeys = {
  all: ["products"] as const,
  lists: () => [...productKeys.all, "list"] as const,
  list: (params: ProductListParams) => [...productKeys.lists(), params] as const,
  details: () => [...productKeys.all, "detail"] as const,
  detail: (id: string) => [...productKeys.details(), id] as const,
}

export function fetchProducts(
  params: ProductListParams = {},
  signal?: AbortSignal,
): Promise<PaginatedEnvelope<Product>> {
  return api.get<PaginatedEnvelope<Product>>("/products", {
    query: { ...params },
    signal,
  })
}

export function fetchProduct(
  id: string,
  signal?: AbortSignal,
): Promise<Product> {
  return api.get<Product>(`/products/${id}`, { signal })
}

// --- Adjustments and alerts (6.8) -----------------------------------------

export const ADJUSTMENT_TYPES = ["ADD", "REMOVE", "COUNT"] as const
export type AdjustmentType = (typeof ADJUSTMENT_TYPES)[number]

/**
 * One row of the append-only stock ledger.
 *
 * `quantityDelta` here is **signed** — `-5` for a removal — which is the opposite
 * convention to the one `CreateAdjustmentInput` takes on the way in. That is not
 * an inconsistency to paper over: the column is a delta so the ledger sums, while
 * the request is a magnitude plus a `type` so a client cannot file "ADD -5". See
 * `mutations.ts`.
 *
 * `reasonCode` is wider than the set a client may submit: rows written by the
 * system carry `Sale` (order completed) or `PurchaseReceived`, and those are
 * refused on the write endpoint. Hence `string` rather than the input union.
 */
export interface StockAdjustment {
  id: string
  productId: string
  productName: string
  branchId: string
  type: AdjustmentType
  /** Signed, as stored. Negative for a removal. */
  quantityDelta: number
  reasonCode: string
  /** Stock after this adjustment was applied. */
  newStockLevel: number
  createdByUserId: string
  createdAt: string
}

export interface AdjustmentListParams {
  pageIndex?: number
  pageSize?: number
  productId?: string
  branchId?: string
  type?: AdjustmentType
  /** ISO date. */
  dateFrom?: string
  dateTo?: string
}

export interface StockAlert {
  id: string
  name: string
  sku: string
  stock: number
  reorderPoint: number
}

/**
 * `GET /inventory/alerts`.
 *
 * Two lists, not one with a severity flag: out-of-stock blocks a sale outright
 * while low-stock is a purchasing prompt, and the dashboard treats them
 * differently. Each array is capped server-side (200), so a long tail is
 * truncated rather than paginated — treat the counts as "at least".
 */
export interface StockAlerts {
  outOfStock: StockAlert[]
  lowStock: StockAlert[]
}

export const inventoryKeys = {
  all: ["inventory"] as const,
  adjustments: () => [...inventoryKeys.all, "adjustments"] as const,
  adjustmentList: (params: AdjustmentListParams) =>
    [...inventoryKeys.adjustments(), params] as const,
  alerts: () => [...inventoryKeys.all, "alerts"] as const,
}

export function fetchAdjustments(
  params: AdjustmentListParams = {},
  signal?: AbortSignal,
): Promise<PaginatedEnvelope<StockAdjustment>> {
  return api.get<PaginatedEnvelope<StockAdjustment>>("/inventory/adjustments", {
    query: { ...params },
    signal,
  })
}

export function fetchStockAlerts(signal?: AbortSignal): Promise<StockAlerts> {
  return api.get<StockAlerts>("/inventory/alerts", { signal })
}
