// ---------------------------------------------------------------------------
// src/lib/mock-data/customers.ts
// CustomerRecord type and MOCK_CUSTOMERS seed data.
//
// totalOrders/totalSpend are derived at render time from OrdersContext
// (useOrders()) by each consumer — not stored here and not computed by a
// helper in this file. This ensures all consumers reflect live session state.
// ---------------------------------------------------------------------------

export type CustomerRecord = {
  id: string
  name: string
  email: string
  phone: string
  address: string
  notes: string
  isActive: boolean
  // totalOrders and totalSpend are intentionally NOT stored here.
  // Derive from useOrders() at render time — see customers/page.tsx and
  // CustomerDetailDialog.tsx for the live-state pattern.
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
