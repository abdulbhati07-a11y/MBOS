// ---------------------------------------------------------------------------
// Mock Orders — Single source of truth for the Sales / POS module.
// All currency values are stored as numbers; display via .toFixed(2).
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
  customerName: string
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
    paymentMethod: "Cash",
    status: "Completed",
    taxRate: 0,
    subtotal: 119.98,
    taxAmount: 0,
    total: 119.98,
    lines: [
      { productId: "1", productName: "Wireless Mouse", unitPrice: 29.99, quantity: 2, lineTotal: 59.98 },
      { productId: "6", productName: "Webcam HD 1080p", unitPrice: 59.99, quantity: 1, lineTotal: 59.99 },
    ],
  },
  {
    id: "ord-002",
    orderNumber: "#1002",
    date: "2026-07-29T11:30:00Z",
    customerName: "Ahmed K.",
    paymentMethod: "Card",
    status: "Completed",
    taxRate: 8,
    subtotal: 249.99,
    taxAmount: 20.00,
    total: 269.99,
    lines: [
      { productId: "4", productName: "Ergonomic Chair", unitPrice: 249.99, quantity: 1, lineTotal: 249.99 },
    ],
  },
  {
    id: "ord-003",
    orderNumber: "#1003",
    date: "2026-07-29T14:45:00Z",
    customerName: "Walk-in",
    paymentMethod: "Mobile",
    status: "Refunded",
    taxRate: 0,
    subtotal: 89.99,
    taxAmount: 0,
    total: 89.99,
    lines: [
      { productId: "2", productName: "Mechanical Keyboard", unitPrice: 89.99, quantity: 1, lineTotal: 89.99 },
    ],
  },
  {
    id: "ord-004",
    orderNumber: "#1004",
    date: "2026-07-30T08:00:00Z",
    customerName: "Sara M.",
    paymentMethod: "Cash",
    status: "Pending",
    taxRate: 5,
    subtotal: 84.97,
    taxAmount: 4.25,
    total: 89.22,
    lines: [
      { productId: "7", productName: "Desk Lamp LED", unitPrice: 34.99, quantity: 1, lineTotal: 34.99 },
      { productId: "8", productName: "Notebook A5 (Pack of 3)", unitPrice: 9.99, quantity: 2, lineTotal: 19.98 },
      { productId: "5", productName: "Monitor Stand", unitPrice: 39.99, quantity: 1, lineTotal: 39.99 },
    ],
  },
  {
    id: "ord-005",
    orderNumber: "#1005",
    date: "2026-07-31T10:20:00Z",
    customerName: "Walk-in",
    paymentMethod: "Card",
    status: "Completed",
    taxRate: 0,
    subtotal: 44.98,
    taxAmount: 0,
    total: 44.98,
    lines: [
      { productId: "3", productName: "USB-C Cable (2m)", unitPrice: 14.99, quantity: 3, lineTotal: 44.97 },
    ],
  },
]
