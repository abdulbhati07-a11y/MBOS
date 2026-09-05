// ---------------------------------------------------------------------------
// src/lib/api/customers/queries.ts
//
// Read side of Section 6.6 customers.
//
// Two exports per domain module: a query-key factory and the fetchers. Keys are
// declared here, next to the requests they describe, so that a mutation
// invalidating "the customer list" cannot drift from the key the list actually
// registered under — the classic react-query bug where a stale table never
// refetches because two files disagree about a key by one array element.
// ---------------------------------------------------------------------------

import { api } from "../client"
import type { PaginatedEnvelope } from "../types"

/** One customer, as `GET /customers` and `GET /customers/:id` return it. */
export interface Customer {
  id: string
  name: string
  email: string
  phone: string
  address: string
  notes: string
  isActive: boolean
  /** ISO 8601. */
  createdAt: string
  updatedAt: string
}

/**
 * One row of a customer's order history.
 *
 * `totalCents` is minor units of the tenant currency — paisa under PKR, not
 * cents. The name is Section 5.10's convention and is a known misnomer
 * (DEBT-023); the unit is what matters, and it is an integer. Render it with
 * `formatMoneyMinor`, never `formatMoney`.
 */
export interface CustomerOrderSummary {
  id: string
  orderNumber: string
  date: string
  status: string
  totalCents: number
}

/** `GET /customers/:id` — the record plus a page of its order history. */
export interface CustomerDetail extends Customer {
  orders: PaginatedEnvelope<CustomerOrderSummary>
}

export interface CustomerListParams {
  pageIndex?: number
  pageSize?: number
  isActive?: boolean
  /** Matches name or email. */
  search?: string
}

/** Pagination here applies to the embedded order history, not the customer. */
export interface CustomerDetailParams {
  pageIndex?: number
  pageSize?: number
}

export const customerKeys = {
  all: ["customers"] as const,
  lists: () => [...customerKeys.all, "list"] as const,
  list: (params: CustomerListParams) =>
    [...customerKeys.lists(), params] as const,
  details: () => [...customerKeys.all, "detail"] as const,
  detail: (id: string, params: CustomerDetailParams = {}) =>
    [...customerKeys.details(), id, params] as const,
}

export function fetchCustomers(
  params: CustomerListParams = {},
  signal?: AbortSignal,
): Promise<PaginatedEnvelope<Customer>> {
  return api.get<PaginatedEnvelope<Customer>>("/customers", {
    query: { ...params },
    signal,
  })
}

export function fetchCustomer(
  id: string,
  params: CustomerDetailParams = {},
  signal?: AbortSignal,
): Promise<CustomerDetail> {
  return api.get<CustomerDetail>(`/customers/${id}`, {
    query: { ...params },
    signal,
  })
}
