// ---------------------------------------------------------------------------
// src/lib/mock-data/purchase-orders.ts
// POStatus, POLineRecord, PurchaseOrderRecord, PO_TRANSITIONS,
// and MOCK_PURCHASE_ORDERS seed data.
//
// supplierName is a string reference — same class of limitation as
// MOCK_ORDERS.customerName in the Sales module.
// TODO: PROV-FR-PUR-03 — replace supplierName string match with supplier ID FK
// when backend exists. Two suppliers with the same name would collide here.
// ---------------------------------------------------------------------------

export type POStatus = "Draft" | "Sent" | "Received" | "Cancelled"

// ---------------------------------------------------------------------------
// PO_TRANSITIONS — single source of truth for the PO status state machine.
// [PROV-FR-PUR-05] Draft → Sent | Cancelled
//                  Sent  → Received | Cancelled
//                  Received  → (terminal)
//                  Cancelled → (terminal)
// The UI derives available actions from this map — no hardcoded conditionals.
// ---------------------------------------------------------------------------
export const PO_TRANSITIONS: Record<POStatus, POStatus[]> = {
  Draft:     ["Sent", "Cancelled"],
  Sent:      ["Received", "Cancelled"],
  Received:  [],
  Cancelled: [],
}

export type POLineRecord = {
  productId: string
  productName: string
  unitCost: number  // buyer-entered cost — independent of product.cost
  quantity: number
  lineTotal: number
}

export type PurchaseOrderRecord = {
  id: string
  poNumber: string
  date: string       // ISO date string
  supplierName: string
  status: POStatus
  subtotal: number
  total: number
  lines: POLineRecord[]
  notes: string
}

export const MOCK_PURCHASE_ORDERS: PurchaseOrderRecord[] = [
  {
    id: "po-001",
    poNumber: "PO-2026-001",
    date: "2026-07-20T10:00:00Z",
    supplierName: "TechSource Ltd.",
    status: "Received",
    subtotal: 370.00,
    total: 370.00,
    notes: "Quarterly electronics restock.",
    lines: [
      { productId: "1", productName: "Wireless Mouse",    unitCost: 11.50, quantity: 20, lineTotal: 230.00 },
      { productId: "6", productName: "Webcam HD 1080p",   unitCost: 23.00, quantity: 6,  lineTotal: 138.00 },
    ],
  },
  {
    id: "po-002",
    poNumber: "PO-2026-002",
    date: "2026-07-25T09:30:00Z",
    supplierName: "OfficePro Supplies",
    status: "Sent",
    subtotal: 554.00,
    total: 554.00,
    notes: "Chairs and notebooks for new hires.",
    lines: [
      { productId: "4", productName: "Ergonomic Chair",         unitCost: 105.00, quantity: 4,  lineTotal: 420.00 },
      { productId: "8", productName: "Notebook A5 (Pack of 3)", unitCost: 2.80,   quantity: 20, lineTotal: 56.00  },
      { productId: "7", productName: "Desk Lamp LED",           unitCost: 13.00,  quantity: 6,  lineTotal: 78.00  },
    ],
  },
  {
    id: "po-003",
    poNumber: "PO-2026-003",
    date: "2026-07-28T14:00:00Z",
    supplierName: "CableWorld Inc.",
    status: "Draft",
    subtotal: 175.00,
    total: 175.00,
    notes: "",
    lines: [
      { productId: "3", productName: "USB-C Cable (2m)", unitCost: 3.25, quantity: 50, lineTotal: 162.50 },
      { productId: "5", productName: "Monitor Stand",    unitCost: 12.50, quantity: 1, lineTotal: 12.50  },
    ],
  },
  {
    id: "po-004",
    poNumber: "PO-2026-004",
    date: "2026-07-15T11:00:00Z",
    supplierName: "GlobalTech Imports",
    status: "Cancelled",
    subtotal: 450.00,
    total: 450.00,
    notes: "Cancelled — supplier couldn't meet delivery date.",
    lines: [
      { productId: "2", productName: "Mechanical Keyboard", unitCost: 42.00, quantity: 10, lineTotal: 420.00 },
      { productId: "5", productName: "Monitor Stand",       unitCost: 15.00, quantity: 2,  lineTotal: 30.00  },
    ],
  },
  {
    id: "po-005",
    poNumber: "PO-2026-005",
    date: "2026-07-31T08:00:00Z",
    supplierName: "TechSource Ltd.",
    status: "Draft",
    subtotal: 180.00,
    total: 180.00,
    notes: "Keyboard restock — pending approval.",
    lines: [
      { productId: "2", productName: "Mechanical Keyboard", unitCost: 44.00, quantity: 4, lineTotal: 176.00 },
      { productId: "1", productName: "Wireless Mouse",      unitCost: 11.00, quantity: 4, lineTotal: 44.00  },
    ],
  },
]
