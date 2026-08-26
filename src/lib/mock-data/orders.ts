// ---------------------------------------------------------------------------
// Mock Orders — Single source of truth for the Sales / POS module.
// All currency values are **rupees** (major units); display via formatMoney from
// src/lib/format/currency.ts, never a bare .toFixed(2).
//
// Tax rates are Pakistani GST: 17% standard, with one order at a reduced 10%
// (Eighth Schedule) so the tax line is exercised at more than one rate, and
// zero-rated orders for the rest. Every subtotal/tax/total below is arithmetic
// on its own lines — one seed order previously had a subtotal that disagreed
// with its single line by a rupee, which is exactly the sort of thing a POS
// demo should not teach.
//
// customerId: matches CustomerRecord.id from MOCK_CUSTOMERS for seed orders.
// Orders created via the POS (NewOrderForm) have customerId: null until the
// Sales↔Customers linking is built in the backend integration phase.
// TODO: DEBT-004 — NewOrderForm must be updated to accept a CustomerRecord
// selection and populate customerId when the backend and customer-linking
// feature are built. See DOCUMENTATION_DEBT.md.
// ---------------------------------------------------------------------------

export type OrderStatus = "Pending" | "Completed" | "Refunded"
export type PaymentMethod = "Cash" | "Card" | "Mobile"

export type OrderLineRecord = {
  productId: string
  productName: string
  unitPrice: number
  quantity: number
  lineTotal: number
}

export type OrderRecord = {
  id: string
  orderNumber: string
  date: string // ISO date string
  customerName: string  // display name, always present
  customerId: string | null  // FK to CustomerRecord.id; null for unlinked POS orders
  paymentMethod: PaymentMethod
  status: OrderStatus
  taxRate: number // percentage, e.g. 8 = 8%
  subtotal: number
  taxAmount: number
  total: number
  lines: OrderLineRecord[]
}

export const MOCK_ORDERS: OrderRecord[] = [
  {
    id: "ord-001",
    orderNumber: "#1001",
    date: "2026-07-28T09:15:00Z",
    customerName: "Walk-in",
    customerId: "cust-003",
    paymentMethod: "Cash",
    status: "Completed",
    taxRate: 0,
    subtotal: 7800,
    taxAmount: 0,
    total: 7800,
    lines: [
      { productId: "1", productName: "Wireless Mouse", unitPrice: 1500, quantity: 2, lineTotal: 3000 },
      { productId: "6", productName: "Webcam HD 1080p", unitPrice: 4800, quantity: 1, lineTotal: 4800 },
    ],
  },
  {
    id: "ord-002",
    orderNumber: "#1002",
    date: "2026-07-29T11:30:00Z",
    customerName: "Ahmed K.",
    customerId: "cust-001",
    paymentMethod: "Card",
    status: "Completed",
    // Standard GST.
    taxRate: 17,
    subtotal: 32000,
    taxAmount: 5440,
    total: 37440,
    lines: [
      { productId: "4", productName: "Ergonomic Chair", unitPrice: 32000, quantity: 1, lineTotal: 32000 },
    ],
  },
  {
    id: "ord-003",
    orderNumber: "#1003",
    date: "2026-07-29T14:45:00Z",
    customerName: "Walk-in",
    customerId: "cust-003",
    paymentMethod: "Mobile",
    status: "Refunded",
    taxRate: 0,
    subtotal: 8500,
    taxAmount: 0,
    total: 8500,
    lines: [
      { productId: "2", productName: "Mechanical Keyboard", unitPrice: 8500, quantity: 1, lineTotal: 8500 },
    ],
  },
  {
    id: "ord-004",
    orderNumber: "#1004",
    date: "2026-07-30T08:00:00Z",
    customerName: "Sara M.",
    customerId: "cust-002",
    paymentMethod: "Cash",
    status: "Pending",
    // Reduced rate, so the tax line is exercised at two different values.
    taxRate: 10,
    subtotal: 6500,
    taxAmount: 650,
    total: 7150,
    lines: [
      { productId: "7", productName: "Desk Lamp LED", unitPrice: 2400, quantity: 1, lineTotal: 2400 },
      { productId: "8", productName: "Notebook A5 (Pack of 3)", unitPrice: 450, quantity: 2, lineTotal: 900 },
      { productId: "5", productName: "Monitor Stand", unitPrice: 3200, quantity: 1, lineTotal: 3200 },
    ],
  },
  {
    id: "ord-005",
    orderNumber: "#1005",
    date: "2026-07-31T10:20:00Z",
    customerName: "Walk-in",
    customerId: "cust-003",
    paymentMethod: "Card",
    status: "Completed",
    taxRate: 0,
    subtotal: 1950,
    taxAmount: 0,
    total: 1950,
    lines: [
      { productId: "3", productName: "USB-C Cable (2m)", unitPrice: 650, quantity: 3, lineTotal: 1950 },
    ],
  },
]
