// ---------------------------------------------------------------------------
// src/lib/mock-data/purchase-orders.ts
// POStatus, POLineRecord, PurchaseOrderRecord, PO_TRANSITIONS,
// and MOCK_PURCHASE_ORDERS seed data.
//
// supplierName is a string reference — same class of limitation as
// MOCK_ORDERS.customerName in the Sales module.
// TODO: PROV-FR-PUR-03 — replace supplierName string match with supplier ID FK
// when backend exists. Two suppliers with the same name would collide here.
//
// unitCost/lineTotal/subtotal/total are **rupees** (major units); display via
// formatMoney from src/lib/format/currency.ts. Wholesale PKR figures run large —
// note that a PO total here is already five digits, which is why the int4 cap in
// the API (Rs 21,474,836.47) is worth knowing about for bulk orders (DEBT-023).
// ---------------------------------------------------------------------------

export type POStatus = "Draft" | "Sent" | "Received" | "Cancelled"

// ---------------------------------------------------------------------------
// PO_TRANSITIONS — single source of truth for the PO status state machine.
// [PROV-FR-PUR-05] Draft → Sent | Cancelled
//                  Sent  → Received | Cancelled
//                  Received  → (terminal)
//                  Cancelled → (terminal)
// The UI derives available actions from this map — no hardcoded conditionals.
//
// TODO: PROV-FR-PUR-05 — the eventual PO API (Section 6/9) MUST re-validate
// these same transitions server-side. This map is a UX affordance only;
// client-side enforcement is not a data-integrity guarantee. A caller hitting
// the API directly could skip Draft → Received without going through Sent.
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
    subtotal: 31500.00,
    total: 31500.00,
    notes: "Quarterly electronics restock.",
    lines: [
      { productId: "1", productName: "Wireless Mouse",    unitCost: 720.00,  quantity: 20, lineTotal: 14400.00 },
      { productId: "6", productName: "Webcam HD 1080p",   unitCost: 2850.00, quantity: 6,  lineTotal: 17100.00 },
    ],
  },
  {
    id: "po-002",
    poNumber: "PO-2026-002",
    date: "2026-07-25T09:30:00Z",
    supplierName: "OfficePro Supplies",
    status: "Sent",
    subtotal: 87800.00,
    total: 87800.00,
    notes: "Chairs and notebooks for new hires.",
    lines: [
      { productId: "4", productName: "Ergonomic Chair",         unitCost: 19000.00, quantity: 4,  lineTotal: 76000.00 },
      { productId: "8", productName: "Notebook A5 (Pack of 3)", unitCost: 200.00,   quantity: 20, lineTotal: 4000.00  },
      { productId: "7", productName: "Desk Lamp LED",           unitCost: 1300.00,  quantity: 6,  lineTotal: 7800.00  },
    ],
  },
  {
    id: "po-003",
    poNumber: "PO-2026-003",
    date: "2026-07-28T14:00:00Z",
    supplierName: "CableWorld Inc.",
    status: "Draft",
    subtotal: 12000.00,
    total: 12000.00,
    notes: "",
    lines: [
      { productId: "3", productName: "USB-C Cable (2m)", unitCost: 205.00,  quantity: 50, lineTotal: 10250.00 },
      { productId: "5", productName: "Monitor Stand",    unitCost: 1750.00, quantity: 1,  lineTotal: 1750.00  },
    ],
  },
  {
    id: "po-004",
    poNumber: "PO-2026-004",
    date: "2026-07-15T11:00:00Z",
    supplierName: "GlobalTech Imports",
    status: "Cancelled",
    subtotal: 54600.00,
    total: 54600.00,
    notes: "Cancelled — supplier couldn't meet delivery date.",
    lines: [
      { productId: "2", productName: "Mechanical Keyboard", unitCost: 5100.00, quantity: 10, lineTotal: 51000.00 },
      { productId: "5", productName: "Monitor Stand",       unitCost: 1800.00, quantity: 2,  lineTotal: 3600.00  },
    ],
  },
  {
    id: "po-005",
    poNumber: "PO-2026-005",
    date: "2026-07-31T08:00:00Z",
    supplierName: "TechSource Ltd.",
    status: "Draft",
    subtotal: 23960.00,
    total: 23960.00,
    notes: "Keyboard restock — pending approval.",
    lines: [
      { productId: "2", productName: "Mechanical Keyboard", unitCost: 5250.00, quantity: 4, lineTotal: 21000.00 },
      { productId: "1", productName: "Wireless Mouse",      unitCost: 740.00,  quantity: 4, lineTotal: 2960.00  },
    ],
  },
]
