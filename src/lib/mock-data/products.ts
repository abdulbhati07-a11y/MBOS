// ---------------------------------------------------------------------------
// Shared Mock Data — Single Source of Truth
// Both Inventory and Sales modules import from here.
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
  { id: "1", name: "Wireless Mouse", sku: "WM-001", category: "Electronics", price: 29.99, cost: 12.00, stock: 45, reorderPoint: 10, uom: "piece" },
  { id: "2", name: "Mechanical Keyboard", sku: "MK-102", category: "Electronics", price: 89.99, cost: 45.00, stock: 8, reorderPoint: 10, uom: "piece" },
  { id: "3", name: "USB-C Cable (2m)", sku: "CBL-UC2", category: "Accessories", price: 14.99, cost: 3.50, stock: 0, reorderPoint: 50, uom: "piece" },
  { id: "4", name: "Ergonomic Chair", sku: "FUR-089", category: "Office Furniture", price: 249.99, cost: 110.00, stock: 12, reorderPoint: 5, uom: "piece" },
  { id: "5", name: "Monitor Stand", sku: "MS-004", category: "Accessories", price: 39.99, cost: 15.00, stock: 2, reorderPoint: 5, uom: "piece" },
  { id: "6", name: "Webcam HD 1080p", sku: "WC-720", category: "Electronics", price: 59.99, cost: 25.00, stock: 18, reorderPoint: 5, uom: "piece" },
  { id: "7", name: "Desk Lamp LED", sku: "DL-015", category: "Office Furniture", price: 34.99, cost: 14.00, stock: 30, reorderPoint: 8, uom: "piece" },
  { id: "8", name: "Notebook A5 (Pack of 3)", sku: "NB-A53", category: "Stationery", price: 9.99, cost: 3.00, stock: 75, reorderPoint: 20, uom: "pack" },
]
