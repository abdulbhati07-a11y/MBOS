import * as z from "zod"

import { isMoneyMajor, MONEY_PRECISION_MESSAGE } from "./money"
import { PAYMENT_METHODS } from "@/lib/api/sales/queries"
import { MAX_LINE_QUANTITY, MAX_ORDER_LINES } from "@/lib/api/sales/mutations"

// ---------------------------------------------------------------------------
// src/lib/validation/sales.ts
//
// Shaped to `POST /orders`, which means three fields that used to live here are
// gone. Each was removed because the API refuses it, and refuses it for a reason:
//
//   - **`unitPrice` is not submitted.** The server snapshots it from
//     `Product.priceCents` at creation. A POS that names its own price is an
//     untraceable discount mechanism. It survives in `orderLineSchema` because the
//     cart has to show a running total, but it is display state — never sent.
//   - **No totals.** `subtotal`, `taxAmount` and `total` are the server's to
//     compute (BR-05). Sending them is a 422 (DEBT-025).
//   - **`taxRate` is not per-order.** The tenant's `defaultTaxRateBps` applies
//     unless an explicit rate is sent, and this form sends none: a cashier freely
//     typing a tax rate onto a record BR-03 then freezes is a compliance problem,
//     not a feature. The rate is a business setting (FR-SET-02) and is shown
//     read-only in the cart.
//
// `customerName` is gone too, replaced by `customerId`. A typed name had nowhere
// to go — the API takes a customer FK or nothing — so it produced orders that
// looked attributed and were not (DEBT-004).
// ---------------------------------------------------------------------------

/**
 * One row of the cart.
 *
 * `productName` and `unitPriceCents` are carried so the cart can render and total
 * itself without re-reading the catalogue on every keystroke. Only `productId`
 * and `quantity` are sent.
 */
export const orderLineSchema = z.object({
  productId: z.string().min(1),
  productName: z.string().min(1),
  /** Minor units, as the catalogue returned them. Display only. */
  unitPriceCents: z.number().int().min(0),
  quantity: z.coerce
    .number()
    .int({ message: "Quantity must be a whole number" })
    .min(1, { message: "Quantity must be at least 1" })
    .max(MAX_LINE_QUANTITY, { message: "Quantity is too large" }),
})

export type OrderLineValues = z.infer<typeof orderLineSchema>

export const newOrderSchema = z.object({
  /** `null` is a walk-in sale, and is the default rather than an error state. */
  customerId: z.string().nullable().default(null),
  paymentMethod: z.enum(PAYMENT_METHODS, {
    message: "Please select a payment method",
  }),
  lines: z
    .array(orderLineSchema)
    .min(1, { message: "Add at least one product to the order" })
    .max(MAX_ORDER_LINES, {
      message: `An order cannot have more than ${MAX_ORDER_LINES} lines`,
    }),
})

export type NewOrderValues = z.infer<typeof newOrderSchema>

// ---------------------------------------------------------------------------
// Refund Schema (BR-03 reversal)
//
// The amount is in rupees here and paisa on the wire, like every other money
// field in the app.
//
// It is not capped client-side at the order total. The server answers 409 when the
// refunds on an order would exceed it, and that check is the only correct one: it
// sees the refunds already taken, which this form does not necessarily know about
// if someone else refunded the same order a moment ago. A local cap would be a
// guess dressed as a validation.
// ---------------------------------------------------------------------------
export const refundSchema = z.object({
  amount: z.coerce
    .number()
    .positive({ message: "Enter an amount greater than zero" })
    .refine(isMoneyMajor, { message: MONEY_PRECISION_MESSAGE }),
  /**
   * Optional on the API, and optional here — but a refund with no stated reason is
   * a hole in the audit trail, so the form asks for one and the UI says why.
   */
  reason: z.string().max(500, { message: "Keep the reason under 500 characters" }),
})

export type RefundValues = z.infer<typeof refundSchema>
