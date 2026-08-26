// ---------------------------------------------------------------------------
// Shared Mock Data — Single Source of Truth
// Both Inventory and Sales modules import from here.
//
// price and cost are **rupees** — major units, matching what a user types. The
// API stores integer paisa (priceCents/costCents), so the swap in the backend
// integration phase converts at the boundary via parseMoneyToMinor in
// src/lib/format/currency.ts. Display goes through formatMoney, never a bare
// .toFixed(2). See DEBT-012.
//
// The figures are Pakistani retail prices for these items, not conversions of
// the dollar amounts they replaced — a mechanical FX multiply gives numbers no
// shop would ever put on a shelf (Rs 8,397.20 for a mouse).
// ---------------------------------------------------------------------------

export type ProductRecord = {
  id: string
  name: string
  sku: string
  category: string
  price: number
  cost: number
  stock: number
  reorderPoint: number
  uom: string
}

export const MOCK_PRODUCTS: ProductRecord[] = [
  { id: "1", name: "Wireless Mouse", sku: "WM-001", category: "Electronics", price: 1500, cost: 750, stock: 45, reorderPoint: 10, uom: "piece" },
  { id: "2", name: "Mechanical Keyboard", sku: "MK-102", category: "Electronics", price: 8500, cost: 5200, stock: 8, reorderPoint: 10, uom: "piece" },
  { id: "3", name: "USB-C Cable (2m)", sku: "CBL-UC2", category: "Accessories", price: 650, cost: 220, stock: 0, reorderPoint: 50, uom: "piece" },
  { id: "4", name: "Ergonomic Chair", sku: "FUR-089", category: "Office Furniture", price: 32000, cost: 19500, stock: 12, reorderPoint: 5, uom: "piece" },
  { id: "5", name: "Monitor Stand", sku: "MS-004", category: "Accessories", price: 3200, cost: 1800, stock: 2, reorderPoint: 5, uom: "piece" },
  { id: "6", name: "Webcam HD 1080p", sku: "WC-720", category: "Electronics", price: 4800, cost: 2900, stock: 18, reorderPoint: 5, uom: "piece" },
  { id: "7", name: "Desk Lamp LED", sku: "DL-015", category: "Office Furniture", price: 2400, cost: 1350, stock: 30, reorderPoint: 8, uom: "piece" },
  { id: "8", name: "Notebook A5 (Pack of 3)", sku: "NB-A53", category: "Stationery", price: 450, cost: 210, stock: 75, reorderPoint: 20, uom: "pack" },
]
