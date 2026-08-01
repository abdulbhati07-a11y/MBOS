"use client"

// ---------------------------------------------------------------------------
// src/hooks/use-dashboard-metrics.ts
//
// Single source of truth for all dashboard-displayed numbers.
// No dashboard widget reads mock data arrays directly — all derivations
// happen here.
//
// Products are received as a parameter (from ProductsContext) so the
// dashboard reflects live inventory state, not the static MOCK_PRODUCTS
// constant.
// ---------------------------------------------------------------------------

import { useMemo } from "react"
import { MOCK_ORDERS, OrderRecord } from "@/lib/mock-data/orders"
import { MOCK_CUSTOMERS } from "@/lib/mock-data/customers"
import { MOCK_SUPPLIERS } from "@/lib/mock-data/suppliers"
import { MOCK_PURCHASE_ORDERS, PO_TRANSITIONS, POStatus } from "@/lib/mock-data/purchase-orders"
import { ProductRecord } from "@/lib/mock-data/products"
import { useProducts } from "@/contexts/products-context"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type POStatusBreakdown = {
  status: POStatus
  count: number
  isTerminal: boolean
}

export type RecentOrderRow = {
  id: string
  orderNumber: string
  date: string
  customerName: string
  customerId: string | null
  total: number
  status: OrderRecord["status"]
}

export type DashboardMetrics = {
  // Widget 1 — Open Purchase Orders by status
  poStatusBreakdown: POStatusBreakdown[]
  openPOCount: number

  // Widget 2 — Suppliers
  activeSupplierCount: number
  totalSupplierCount: number

  // Widget 3 — Sales / Orders
  totalOrderCount: number
  totalOrderValue: number
  recentOrders: RecentOrderRow[]

  // Widget 4 — Customers
  activeCustomerCount: number
  totalCustomerCount: number

  // Widget 5 — Inventory health (live from ProductsContext)
  totalProductCount: number
  lowStockCount: number     // stock > 0 && stock <= reorderPoint
  outOfStockCount: number   // stock === 0
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDashboardMetrics(): DashboardMetrics {
  // Live products from shared context — reflects Inventory adjustments
  const products = useProducts()

  return useMemo(() => {

    // ── Widget 1: Purchase Orders ──────────────────────────────────────────
    const allStatuses: POStatus[] = ["Draft", "Sent", "Received", "Cancelled"]
    const poStatusBreakdown: POStatusBreakdown[] = allStatuses.map((status) => ({
      status,
      count: MOCK_PURCHASE_ORDERS.filter((po) => po.status === status).length,
      isTerminal: PO_TRANSITIONS[status].length === 0,
    }))
    const openPOCount = poStatusBreakdown
      .filter((s) => !s.isTerminal)
      .reduce((sum, s) => sum + s.count, 0)

    // ── Widget 2: Suppliers ────────────────────────────────────────────────
    const activeSupplierCount = MOCK_SUPPLIERS.filter((s) => s.isActive).length
    const totalSupplierCount = MOCK_SUPPLIERS.length

    // ── Widget 3: Sales / Orders ───────────────────────────────────────────
    const totalOrderCount = MOCK_ORDERS.length
    const totalOrderValue = MOCK_ORDERS.reduce((sum, o) => sum + o.total, 0)

    const recentOrders: RecentOrderRow[] = [...MOCK_ORDERS]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 5)
      .map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        date: o.date,
        customerName: o.customerName,
        customerId: o.customerId,
        total: o.total,
        status: o.status,
      }))

    // ── Widget 4: Customers ────────────────────────────────────────────────
    const activeCustomerCount = MOCK_CUSTOMERS.filter((c) => c.isActive).length
    const totalCustomerCount = MOCK_CUSTOMERS.length

    // ── Widget 5: Inventory health ─────────────────────────────────────────
    // Derived from live ProductsContext — matches the StatusBadge categories
    // already used in the Inventory page (In Stock / Low Stock / Out of Stock)
    const totalProductCount = products.length
    const lowStockCount = products.filter(
      (p) => p.stock > 0 && p.stock <= p.reorderPoint
    ).length
    const outOfStockCount = products.filter((p) => p.stock === 0).length

    return {
      poStatusBreakdown,
      openPOCount,
      activeSupplierCount,
      totalSupplierCount,
      totalOrderCount,
      totalOrderValue,
      recentOrders,
      activeCustomerCount,
      totalCustomerCount,
      totalProductCount,
      lowStockCount,
      outOfStockCount,
    }
  }, [products]) // re-derives when live product state changes
}
