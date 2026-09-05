// ---------------------------------------------------------------------------
// src/lib/api/suppliers/mutations.ts
//
// Write side of Section 6.6 suppliers.
//
// Permission note, asymmetric like customers: POST and PATCH need
// `purchases.write`, DELETE needs `purchases.delete`. Under the built-in matrix a
// Cashier has no purchases permission at all, a Manager can create and edit but
// not delete, and only an Owner can delete. Gating a delete button on "can write"
// would offer an action the API answers with 403.
// ---------------------------------------------------------------------------

import { api } from "../client"
import type { Supplier } from "./queries"

/**
 * Fields accepted by `POST /suppliers`.
 *
 * Every key exists on the server DTO — a hard requirement, not tidiness: the
 * pipe runs with `forbidNonWhitelisted: true`, so one unrecognised property fails
 * the whole request with 422. `contactPerson` is required here (min 2 chars),
 * which is the one shape difference from customers worth remembering.
 */
export interface CreateSupplierInput {
  /** Minimum 2 characters, server-enforced. */
  name: string
  /** Required, minimum 2 characters. */
  contactPerson: string
  email: string
  phone?: string
  address?: string
  categories?: string
  notes?: string
  isActive?: boolean
}

/**
 * `PATCH /suppliers/:id`. Every field optional; an omitted field means "leave it
 * alone" rather than "clear it" — send `""` to blank an optional string.
 */
export type UpdateSupplierInput = Partial<CreateSupplierInput>

export function createSupplier(input: CreateSupplierInput): Promise<Supplier> {
  return api.post<Supplier>("/suppliers", input)
}

export function updateSupplier(
  id: string,
  input: UpdateSupplierInput,
): Promise<Supplier> {
  return api.patch<Supplier>(`/suppliers/${id}`, input)
}

/**
 * Soft delete. Returns the updated record rather than 204, and the supplier's
 * purchase-order history survives — a posted PO is a financial record and must
 * not vanish because its supplier was removed. Reviving the supplier keeps that
 * history.
 */
export function deleteSupplier(id: string): Promise<Supplier> {
  return api.del<Supplier>(`/suppliers/${id}`)
}
