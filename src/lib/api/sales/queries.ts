// ---------------------------------------------------------------------------
// src/lib/api/sales/queries.ts
//
// Read side of Section 6.7 — orders.
//
// Every `*Cents` field is minor units (paisa under PKR) and every one of them is
// computed by the server, never sent by the client. See `mutations.ts`.
// ---------------------------------------------------------------------------

import { api } from "../client"
import type { PaginatedEnvelope } from "../types"

export const ORDER_STATUSES = ["Pending", "Completed", "Refunded"] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

export const PAYMENT_METHODS = ["Cash", "Card", "Mobile"] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export interface OrderLine {
  id: string
  productId: string
  /**
   * The product name **as it read when the item was sold** (BR-10), not a live
   * lookup. Renaming a product does not rewrite the receipts it appears on, so
   * this may differ from the current `Product.name` — show this one on any view of
   * a past order.
   */
  productName: string
  /** Minor units. Snapshotted at sale time; the client never chooses it. */
  unitPriceCents: number
  quantity: number
  lineTotalCents: number
}

export interface Refund {
  id: string
  orderId: string
  amountCents: number
  reason: string
  createdByUserId: string
  createdAt: string
}

export interface Order {
  id: string
  orderNumber: string
  date: string
  branchId: string
  /** `null` for a walk-in sale. */
  customerId: string | null
  /**
   * The customer's **current** name; `null` for a walk-in sale.
   *
   * Joined server-side so a sales list can name the buyer without a
   * `GET /customers/:id` per row. Note that it is not a snapshot the way
   * `OrderLine.productName` is: a rename moves this and does not move the line
   * name, because a receipt must keep saying what it said when it printed while
   * "whose order is this" should follow the customer.
   */
  customerName: string | null
  /** Distinct lines on the order — `2` means two products, not two items sold. */
  lineCount: number
  paymentMethod: string
  status: OrderStatus
  /** Basis points, frozen onto the order with the total it produced. */
  taxRateBps: number
  subtotalCents: number
  taxAmountCents: number
  totalCents: number
  createdAt: string
  updatedAt: string
}

export interface OrderDetail extends Order {
  lines: OrderLine[]
  refunds: Refund[]
  /**
   * Sum of `refunds[].amountCents`, computed server-side.
   *
   * Needed because `status: "Refunded"` only means *at least one* refund exists —
   * it does not mean fully refunded. A UI that reads the status alone cannot tell
   * a Rs 100 refund on a Rs 10,000 order from a full reversal. Compare this
   * against `totalCents` to label it.
   */
  refundedCents: number
}

export interface OrderListParams {
  pageIndex?: number
  pageSize?: number
  status?: OrderStatus
  customerId?: string
  branchId?: string
  /** ISO date. */
  dateFrom?: string
  dateTo?: string
}

export const orderKeys = {
  all: ["orders"] as const,
  lists: () => [...orderKeys.all, "list"] as const,
  list: (params: OrderListParams) => [...orderKeys.lists(), params] as const,
  details: () => [...orderKeys.all, "detail"] as const,
  detail: (id: string) => [...orderKeys.details(), id] as const,
}

export function fetchOrders(
  params: OrderListParams = {},
  signal?: AbortSignal,
): Promise<PaginatedEnvelope<Order>> {
  return api.get<PaginatedEnvelope<Order>>("/orders", {
    query: { ...params },
    signal,
  })
}

export function fetchOrder(
  id: string,
  signal?: AbortSignal,
): Promise<OrderDetail> {
  return api.get<OrderDetail>(`/orders/${id}`, { signal })
}

/** `true` when the whole order value has been refunded. */
export function isFullyRefunded(order: OrderDetail): boolean {
  return order.refundedCents >= order.totalCents
}

/** What is still refundable on an order, in minor units. */
export function refundableCents(order: OrderDetail): number {
  return Math.max(0, order.totalCents - order.refundedCents)
}
