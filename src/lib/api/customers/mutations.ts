// ---------------------------------------------------------------------------
// src/lib/api/customers/mutations.ts
//
// Write side of Section 6.6 customers.
//
// Permission note, because it is not symmetric: POST and PATCH need
// `customers.write`, DELETE needs `customers.delete`. Under the built-in matrix
// that means a Cashier is read-only here and only an Owner can delete — Manager
// has write but not delete. A UI that gates the delete button on "can write"
// would offer an action the API answers with 403.
// ---------------------------------------------------------------------------

import { api } from "../client"
import type { Customer } from "./queries"

/**
 * Fields accepted by `POST /customers`.
 *
 * Every key here exists on the server DTO. That is a hard requirement, not
 * tidiness: the validation pipe runs with `forbidNonWhitelisted: true`, so one
 * unrecognised property fails the whole request with 422. Spreading a form's
 * values straight into these calls is therefore unsafe whenever the form holds
 * fields the API does not — pick the keys explicitly.
 */
export interface CreateCustomerInput {
  /** Minimum 2 characters, server-enforced. */
  name: string
  email: string
  phone?: string
  address?: string
  notes?: string
  isActive?: boolean
}

/**
 * `PATCH /customers/:id`. Every field optional, and an omitted field means
 * "leave it alone" rather than "clear it" — send `""` to blank an optional
 * string.
 */
export type UpdateCustomerInput = Partial<CreateCustomerInput>

export function createCustomer(input: CreateCustomerInput): Promise<Customer> {
  return api.post<Customer>("/customers", input)
}

export function updateCustomer(
  id: string,
  input: UpdateCustomerInput,
): Promise<Customer> {
  return api.patch<Customer>(`/customers/${id}`, input)
}

/**
 * Soft delete. Returns the updated record rather than 204, and the customer's
 * order history survives — per BR-03 a posted order is immutable, so deleting the
 * customer who placed it must not erase it. Deleting also frees the email for
 * reuse, and reviving that customer keeps their history.
 */
export function deleteCustomer(id: string): Promise<Customer> {
  return api.del<Customer>(`/customers/${id}`)
}
