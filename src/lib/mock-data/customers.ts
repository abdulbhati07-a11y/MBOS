// ---------------------------------------------------------------------------
// src/lib/mock-data/customers.ts
// CustomerRecord type, MOCK_CUSTOMERS seed data, and getCustomerStats helper.
//
// getCustomerStats matches by customerId (FK), not customerName.
// Seed MOCK_ORDERS have customerId populated. POS-created orders have
// customerId: null until backend customer-linking is built (DEBT-004).
// ---------------------------------------------------------------------------

import { MOCK_ORDERS } from "@/lib/mock-data/orders"

export type CustomerRecord = {
  id: string
  name: string
  email: string
  phone: string
  address: string
  notes: string
  isActive: boolean
  // totalOrders and totalSpend are intentionally NOT stored here.
  // Use getCustomerStats(customer.id) to derive them from MOCK_ORDERS at
  // render time, so the list columns and the detail dialog can never disagree.
}

export const MOCK_CUSTOMERS: CustomerRecord[] = [
  {
    id: "cust-001",
    name: "Ahmed K.",
    email: "ahmed.k@example.com",
    phone: "+1 555-0101",
    address: "12 Maple Street, Springfield",
    notes: "Preferred payment: Card",
    isActive: true,
  },
  {
    id: "cust-002",
    name: "Sara M.",
    email: "sara.m@example.com",
    phone: "+1 555-0102",
    address: "88 Oak Avenue, Shelbyville",
    notes: "",
    isActive: true,
  },
  {
    id: "cust-003",
    name: "Walk-in",
    email: "walkin@store.local",
    phone: "",
    address: "",
    notes: "Catch-all record for anonymous walk-in sales",
    isActive: true,
  },
  {
    id: "cust-004",
    name: "Tariq B.",
    email: "tariq.b@example.com",
    phone: "+1 555-0104",
    address: "5 Pine Road, Capital City",
    notes: "Bulk buyer — usually orders in quantity",
    isActive: true,
  },
  {
    id: "cust-005",
    name: "Lena H.",
    email: "lena.h@example.com",
    phone: "+1 555-0105",
    address: "200 Birch Lane, Ogdenville",
    notes: "",
    isActive: true,
  },
  {
    id: "cust-006",
    name: "Marcus R.",
    email: "marcus.r@example.com",
    phone: "+1 555-0106",
    address: "77 Elm Court, North Haverbrook",
    notes: "Do not call after 6 pm",
    isActive: false,
  },
  {
    id: "cust-007",
    name: "Yuki T.",
    email: "yuki.t@example.com",
    phone: "+1 555-0107",
    address: "34 Cedar Way, Brockway",
    notes: "",
    isActive: false,
  },
  {
    id: "cust-008",
    name: "Priya N.",
    email: "priya.n@example.com",
    phone: "+1 555-0108",
    address: "9 Willow Close, Springfield",
    notes: "Referred by Ahmed K.",
    isActive: true,
  },
]

// ---------------------------------------------------------------------------
// getCustomerStats
//
// Derives totalOrders and totalSpend for a customer by matching against
// MOCK_ORDERS on customerId (FK, not name string).
//
// Orders with customerId: null (POS-created, unlinked orders) are excluded
// — they will not appear in any customer's stats until backend linking exists.
// TODO: DEBT-004 — when NewOrderForm gains customer selection, newly placed
// orders will populate customerId and appear here automatically.
// ---------------------------------------------------------------------------
export function getCustomerStats(customerId: string): {
  totalOrders: number
  totalSpend: number
} {
  const matched = MOCK_ORDERS.filter((o) => o.customerId === customerId)
  return {
    totalOrders: matched.length,
    totalSpend: matched.reduce((sum, o) => sum + o.total, 0),
  }
}
