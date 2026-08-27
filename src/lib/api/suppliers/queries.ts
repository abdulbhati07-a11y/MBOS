// ---------------------------------------------------------------------------
// src/lib/api/suppliers/queries.ts
//
// Read side of Section 6.6 suppliers.
//
// Suppliers are gated on the **purchases** module, not a module of their own —
// `GET /suppliers` needs `purchases.read`. That is why this lives beside the
// purchase-orders module in the UI: they are one screen and one permission.
//
// The key factory is declared here, next to the requests it names, for the same
// reason the customers module does it: a mutation invalidating "the supplier
// list" reads its key from this file, so the two cannot drift apart by one array
// element and leave a stale table that never refetches.
// ---------------------------------------------------------------------------

import { api } from "../client"
import type { PaginatedEnvelope } from "../types"

/** One supplier, as `GET /suppliers` and `GET /suppliers/:id` return it. */
export interface Supplier {
  id: string
  name: string
  /** Required by the server DTO (min 2 chars), unlike the customer contact. */
  contactPerson: string
  email: string
  phone: string
  address: string
  /** Free-text list, comma-separated by convention — not a normalised tag set. */
  categories: string
  notes: string
  isActive: boolean
  /** ISO 8601. */
  createdAt: string
  updatedAt: string
}

/**
 * One row of a supplier's purchase-order history, as embedded in the detail
 * response.
 *
 * `totalCents` is minor units (paisa under PKR), integer — render with
 * `formatMoneyMinor`, never `formatMoney`.
 */
export interface SupplierPurchaseOrderSummary {
  id: string
  poNumber: string
  date: string
  status: string
  totalCents: number
}

/** `GET /suppliers/:id` — the record plus a page of its PO history. */
export interface SupplierDetail extends Supplier {
  purchaseOrders: PaginatedEnvelope<SupplierPurchaseOrderSummary>
}

export interface SupplierListParams {
  pageIndex?: number
  pageSize?: number
  isActive?: boolean
  /** Matches name or email. */
  search?: string
}

/** Pagination here applies to the embedded PO history, not the supplier list. */
export interface SupplierDetailParams {
  pageIndex?: number
  pageSize?: number
}

export const supplierKeys = {
  all: ["suppliers"] as const,
  lists: () => [...supplierKeys.all, "list"] as const,
  list: (params: SupplierListParams) =>
    [...supplierKeys.lists(), params] as const,
  details: () => [...supplierKeys.all, "detail"] as const,
  detail: (id: string, params: SupplierDetailParams = {}) =>
    [...supplierKeys.details(), id, params] as const,
}

export function fetchSuppliers(
  params: SupplierListParams = {},
  signal?: AbortSignal,
): Promise<PaginatedEnvelope<Supplier>> {
  return api.get<PaginatedEnvelope<Supplier>>("/suppliers", {
    query: { ...params },
    signal,
  })
}

export function fetchSupplier(
  id: string,
  params: SupplierDetailParams = {},
  signal?: AbortSignal,
): Promise<SupplierDetail> {
  return api.get<SupplierDetail>(`/suppliers/${id}`, {
    query: { ...params },
    signal,
  })
}
