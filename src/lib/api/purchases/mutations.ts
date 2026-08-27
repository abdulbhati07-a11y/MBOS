// ---------------------------------------------------------------------------
// src/lib/api/purchases/mutations.ts
//
// Write side of Section 6.9 — purchase orders.
//
// Two writes only: create a PO, and move its status. There is no financial PATCH
// and no DELETE — a PO is a document that is drafted, sent, received or
// cancelled, never edited in place or erased. Both need `purchases.write`.
//
// Money crosses this boundary as integer **paisa** (`unitCostCents`). The form
// works in rupees for the buyer; convert once, here at the edge, with
// `parseMoneyToMinor` — never `value * 100`, which drifts on prices like 8.115.
// ---------------------------------------------------------------------------

import { api } from "../client"
import type { POStatus, PurchaseOrderDetail } from "./queries"

/**
 * One line of a new PO. `unitCostCents` is minor units and `quantity` is 1..1e6,
 * both server-enforced. `productId` must be a real product UUID.
 */
export interface CreatePOLineInput {
  productId: string
  unitCostCents: number
  quantity: number
}

/**
 * Fields accepted by `POST /purchase-orders`.
 *
 * `lines` must hold 1..500 entries. Every key here exists on the server DTO;
 * `forbidNonWhitelisted` turns an extra property into a 422, so the form's
 * display-only fields (line totals, product names) are dropped before this shape
 * is built — do not spread raw form values in.
 */
export interface CreatePurchaseOrderInput {
  supplierId: string
  notes?: string
  lines: CreatePOLineInput[]
}

export function createPurchaseOrder(
  input: CreatePurchaseOrderInput,
): Promise<PurchaseOrderDetail> {
  return api.post<PurchaseOrderDetail>("/purchase-orders", input)
}

/**
 * `PATCH /purchase-orders/:id/status`.
 *
 * The body field is `toStatus`, not `status` — a mismatch here fails
 * `forbidNonWhitelisted` with a 422 that names `status` as unexpected. An
 * illegal-but-well-formed move (e.g. Draft → Received) is a 409
 * `INVALID_STATUS_TRANSITION`, which the caller surfaces rather than the field
 * validation path.
 */
export function updatePurchaseOrderStatus(
  id: string,
  toStatus: POStatus,
): Promise<PurchaseOrderDetail> {
  return api.patch<PurchaseOrderDetail>(`/purchase-orders/${id}/status`, {
    toStatus,
  })
}
