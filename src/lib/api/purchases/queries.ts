// ---------------------------------------------------------------------------
// src/lib/api/purchases/queries.ts
//
// Read side of Section 6.9 — purchase orders.
//
// The controller path is `purchase-orders`; the UI calls this area "Purchases".
// Every `*Cents` field is minor units (paisa under PKR), integer, computed
// server-side — render with `formatMoneyMinor`, never `formatMoney`. A PO carries
// no tax, so `totalCents === subtotalCents`; both are sent so the summary reads
// the same as an order's.
// ---------------------------------------------------------------------------

import { api } from "../client"
import type { PaginatedEnvelope } from "../types"

export const PO_STATUSES = ["Draft", "Sent", "Received", "Cancelled"] as const
export type POStatus = (typeof PO_STATUSES)[number]

/**
 * The PO status state machine, mirrored on the client.
 *
 *   Draft     → Sent | Cancelled
 *   Sent      → Received | Cancelled
 *   Received  → (terminal)
 *   Cancelled → (terminal)
 *
 * This is a UX affordance only — it decides which transition buttons a row
 * shows. The server re-validates every move and answers an illegal one with 409
 * `INVALID_STATUS_TRANSITION` regardless of what the UI offered, so this map must
 * stay in step with the backend's rules but is not itself the guarantee. The
 * authoritative per-PO history comes back on the detail response.
 */
export const PO_TRANSITIONS: Record<POStatus, POStatus[]> = {
  Draft: ["Sent", "Cancelled"],
  Sent: ["Received", "Cancelled"],
  Received: [],
  Cancelled: [],
}

export interface POLine {
  id: string
  productId: string
  /** Product name as it read when the PO was drafted; not a live lookup. */
  productName: string
  /** Minor units. Buyer-entered, independent of the product's own cost. */
  unitCostCents: number
  quantity: number
  lineTotalCents: number
}

/** One row of the append-only status-change audit trail. */
export interface POStatusTransition {
  id: string
  fromStatus: POStatus
  toStatus: POStatus
  changedByUserId: string
  changedAt: string
}

/**
 * `GET /purchase-orders` row.
 *
 * `supplierId` is the FK and `supplierName` is joined server-side for display —
 * unlike the mock, where the PO held only a name string and two suppliers sharing
 * a name would collide. `lineCount` is the distinct-line count; the lines
 * themselves are on the detail response only, so a list row cannot render them.
 */
export interface PurchaseOrder {
  id: string
  poNumber: string
  date: string
  supplierId: string
  supplierName: string
  status: POStatus
  subtotalCents: number
  /** Equals `subtotalCents` — a PO carries no tax. */
  totalCents: number
  notes: string
  lineCount: number
  createdAt: string
  updatedAt: string
}

/** `GET /purchase-orders/:id` — the row plus its lines and status history. */
export interface PurchaseOrderDetail extends PurchaseOrder {
  lines: POLine[]
  statusTransitions: POStatusTransition[]
}

export interface PurchaseOrderListParams {
  pageIndex?: number
  pageSize?: number
  status?: POStatus
  supplierId?: string
  /** ISO date. */
  dateFrom?: string
  dateTo?: string
}

export const purchaseOrderKeys = {
  all: ["purchase-orders"] as const,
  lists: () => [...purchaseOrderKeys.all, "list"] as const,
  list: (params: PurchaseOrderListParams) =>
    [...purchaseOrderKeys.lists(), params] as const,
  details: () => [...purchaseOrderKeys.all, "detail"] as const,
  detail: (id: string) => [...purchaseOrderKeys.details(), id] as const,
  transitions: (id: string) =>
    [...purchaseOrderKeys.detail(id), "transitions"] as const,
}

export function fetchPurchaseOrders(
  params: PurchaseOrderListParams = {},
  signal?: AbortSignal,
): Promise<PaginatedEnvelope<PurchaseOrder>> {
  return api.get<PaginatedEnvelope<PurchaseOrder>>("/purchase-orders", {
    query: { ...params },
    signal,
  })
}

export function fetchPurchaseOrder(
  id: string,
  signal?: AbortSignal,
): Promise<PurchaseOrderDetail> {
  return api.get<PurchaseOrderDetail>(`/purchase-orders/${id}`, { signal })
}

/**
 * The status-change history as a standalone list. The same rows are embedded on
 * the detail response as `statusTransitions`, so prefer that when the detail is
 * already loaded; this endpoint exists for views that want only the trail.
 */
export function fetchPOStatusTransitions(
  id: string,
  signal?: AbortSignal,
): Promise<POStatusTransition[]> {
  return api.get<POStatusTransition[]>(`/purchase-orders/${id}/transitions`, {
    signal,
  })
}
