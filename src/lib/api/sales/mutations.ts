// ---------------------------------------------------------------------------
// src/lib/api/sales/mutations.ts
//
// Write side of Section 6.7 — orders.
//
// Three absences here are the whole design, and a form that fights them will get
// 422s rather than silent acceptance:
//
//   1. **No totals.** `subtotalCents`, `taxAmountCents` and `totalCents` are the
//      server's to compute from the lines and the tax rate. Sending them is a 422
//      naming the field (DEBT-025) — loud on purpose, because a silent ignore
//      would answer 201 to a client that believes its total was accepted, on the
//      one record BR-03 forbids correcting afterwards.
//   2. **No unit price.** Snapshotted from `Product.priceCents` at creation. A POS
//      that could name its own price is an untraceable discount mechanism.
//   3. **No `status`.** A new order is `Pending`; `Completed` is its own endpoint;
//      `Refunded` is a side effect of a refund and never client-writable.
//
// And no delete. The route is unregistered, not permission-gated, so it answers
// 404 — a 403 would imply the operation exists behind a grant it does not.
// ---------------------------------------------------------------------------

import { api } from "../client"
import type { OrderDetail, PaymentMethod, Refund } from "./queries"

/** Payload guards, mirrored from the DTO so a form can refuse before a round trip. */
export const MAX_ORDER_LINES = 500
export const MAX_LINE_QUANTITY = 1_000_000
export const MAX_TAX_RATE_BPS = 10_000

export interface CreateOrderLineInput {
  productId: string
  /** At least 1. */
  quantity: number
}

export interface CreateOrderInput {
  /**
   * Omit — or pass `null` — for a walk-in sale. Both mean the same thing, so a
   * form that clears its customer field does not have to strip the key.
   */
  customerId?: string | null
  branchId: string
  paymentMethod: PaymentMethod
  /**
   * Omit to use the tenant's configured `defaultTaxRateBps`.
   *
   * Falling back to the tenant setting rather than to 0 is deliberate: a client
   * that forgets the field gets the real rate, not a silently untaxed order that
   * BR-03 then freezes. Sending an explicit `0` still wins — that is how a
   * zero-rated sale is recorded, and it must be a choice rather than an omission.
   */
  taxRateBps?: number
  /** At least one line. */
  lines: CreateOrderLineInput[]
}

/** Returns the full detail shape, so a receipt can be rendered without a re-read. */
export function createOrder(input: CreateOrderInput): Promise<OrderDetail> {
  return api.post<OrderDetail>("/orders", input)
}

/**
 * `PATCH /orders/:id/status` — the only transition that exists.
 *
 * `Completed` is the sole accepted value, so there is nothing to parameterise.
 * Completing an order is what decrements stock and writes the `Sale` ledger rows,
 * which is why it is a distinct step from creating one.
 */
export function completeOrder(id: string): Promise<OrderDetail> {
  return api.patch<OrderDetail>(`/orders/${id}/status`, { status: "Completed" })
}

export interface CreateRefundInput {
  /**
   * Minor units. May be less than the order total, and several refunds may be
   * taken against one order — but their sum may not exceed it, and exceeding it
   * is a 409 rather than a clamp.
   */
  amountCents: number
  reason?: string
}

/**
 * Needs `sales.refund`, **not** `sales.write`. No built-in Cashier holds it, so a
 * refund button visible to a cashier is a button that 403s: gate it on
 * `sales.refund` specifically. That separation is BR-03 at the RBAC layer — taking
 * money and giving it back are separately grantable.
 */
export function refundOrder(
  id: string,
  input: CreateRefundInput,
): Promise<Refund> {
  return api.post<Refund>(`/orders/${id}/refund`, input)
}
