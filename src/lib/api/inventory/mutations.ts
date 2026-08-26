// ---------------------------------------------------------------------------
// src/lib/api/inventory/mutations.ts
//
// Write side of Sections 6.6 (products) and 6.8 (adjustments).
//
// The load-bearing rule of this module: **stock is not a product field.**
// `UpdateProductInput` has no `stock`, because `PATCH /products/:id` refuses it —
// with a 422, not a silent drop, so a client can never believe it moved stock
// when it did not. Every stock movement goes through `createAdjustment` and
// leaves a ledger row carrying a reason code. That single-writer rule is the
// entire reason the inventory count is worth trusting (BR-02).
// ---------------------------------------------------------------------------

import { api } from "../client"
import type { AdjustmentType, Product, StockAdjustment } from "./queries"

// --- Products --------------------------------------------------------------

export interface CreateProductInput {
  /** Min 2 characters. */
  name: string
  /** Min 3 characters. Unique per tenant — a duplicate is a 409. */
  sku: string
  category: string
  /**
   * **Minor units**, integer. A mock-data price of `29.99` must be converted with
   * `parseMoneyToMinor` first; sending the float is a 422 naming the field, which
   * is far better than a row that is off by two orders of magnitude.
   */
  priceCents: number
  /** Minor units, integer. */
  costCents: number
  /** Unit of measure. */
  uom: string
  reorderPoint: number
  /**
   * Opening stock. Defaults to 0, and 0 is the right answer nearly always:
   * a non-zero balance written here leaves no ledger row explaining where the
   * goods came from, so the audit trail starts mid-story. Receive stock with
   * `createAdjustment({ type: "ADD", reasonCode: "Received" })` instead.
   */
  initialStock?: number
  isActive?: boolean
}

/** Metadata only — see the module header on why `stock` is absent. */
export type UpdateProductInput = Partial<Omit<CreateProductInput, "initialStock">>

export function createProduct(input: CreateProductInput): Promise<Product> {
  return api.post<Product>("/products", input)
}

export function updateProduct(
  id: string,
  input: UpdateProductInput,
): Promise<Product> {
  return api.patch<Product>(`/products/${id}`, input)
}

/** Soft delete; needs `inventory.delete`, which only an Owner holds. */
export function deleteProduct(id: string): Promise<Product> {
  return api.del<Product>(`/products/${id}`)
}

// --- Adjustments -----------------------------------------------------------

/**
 * Reason codes a client may submit.
 *
 * `Sale` and `PurchaseReceived` are deliberately not here. The server writes those
 * when an order completes or a purchase order is received; accepting them from a
 * client would let a user forge a sale-shaped ledger row with no order behind it,
 * which is exactly the reconciliation the ledger exists to make possible.
 */
export const CLIENT_REASON_CODES = [
  "Received",
  "Returned",
  "Damaged",
  "Correction",
] as const
export type ClientReasonCode = (typeof CLIENT_REASON_CODES)[number]

/**
 * `POST /inventory/adjustments`.
 *
 * **`quantityDelta` is unsigned on the way in**, and `type` carries the sign.
 * Removing five units is `{ type: "REMOVE", quantityDelta: 5 }` — positive five.
 * Sending `-5` is a 422. The server stores it signed; the two readings are
 * reconciled there, not here (DEBT-028).
 *
 * For `type: "COUNT"` the field is neither a magnitude nor a delta but the
 * **absolute new stock level** from a stock take, and 0 is legal — a shelf may
 * genuinely be empty. For `ADD` and `REMOVE`, 0 is refused.
 *
 * Note the field name: `StockAdjustmentDialog` currently sends `quantity`, which
 * is a 422 under `forbidNonWhitelisted`. Use this type, not the form's shape.
 */
export interface CreateAdjustmentInput {
  productId: string
  branchId: string
  type: AdjustmentType
  /** Unsigned magnitude for ADD/REMOVE; absolute new level for COUNT. */
  quantityDelta: number
  reasonCode: ClientReasonCode
}

export function createAdjustment(
  input: CreateAdjustmentInput,
): Promise<StockAdjustment> {
  return api.post<StockAdjustment>("/inventory/adjustments", input)
}
