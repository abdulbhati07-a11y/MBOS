"use client"

// ---------------------------------------------------------------------------
// src/hooks/use-dashboard-metrics.ts
//
// Single source of truth for all dashboard-displayed numbers.
// No dashboard widget reads MOCK_ORDERS, MOCK_CUSTOMERS, MOCK_SUPPLIERS, or
// MOCK_PURCHASE_ORDERS directly — all derivations happen here.
//
// Low-stock / Inventory metrics are intentionally absent: the Inventory module
// is not confirmed in this track yet.
// TODO: add lowStockCount once Inventory integration is confirmed.
// ---------------------------------------------------------------------------

import { useMemo } from "react"
import { MOCK_ORDERS, OrderRecord } from "@/lib/mock-data/orders"
import { MOCK_CUSTOMERS } from "@/lib/mock-data/customers"
import { MOCK_SUPPLIERS } from "@/lib/mock-data/suppliers"
import { MOCK_PURCHASE_ORDERS, PO_TRANSITIONS, POStatus } from "@/lib/mock-data/purchase-orders"

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
  // customerName is always the display string stored on the order.
  // customerId may be null for POS-created orders not yet linked to a
  // CustomerRecord. The hook never crashes on null — it passes through
  // customerName as-is regardless of whether customerId is present.
  customerName: string
  customerId: string | null
  total: number
  status: OrderRecord["status"]
}

export type DashboardMetrics = {
  // Widget 1 — Open Purchase Orders by status
  poStatusBreakdown: POStatusBreakdown[]
  openPOCount: number          // sum of non-terminal statuses

  // Widget 2 — Suppliers
  activeSupplierCount: number
  totalSupplierCount: number

  // Widget 3 — Sales / Orders
  totalOrderCount: number
  totalOrderValue: number      // sum of all order totals
  recentOrders: RecentOrderRow[] // 5 most recent by date

  // Widget 4 — Customers
  activeCustomerCount: number
  totalCustomerCount: number
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDashboardMetrics(): DashboardMetrics {
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

    // 5 most recent orders by date descending
    const recentOrders: RecentOrderRow[] = [...MOCK_ORDERS]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 5)
      .map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        date: o.date,
        customerName: o.customerName,   // always present — safe display fallback
        customerId: o.customerId,        // may be null; widgets handle gracefully
        total: o.total,
        status: o.status,
      }))

    // ── Widget 4: Customers ────────────────────────────────────────────────
    const activeCustomerCount = MOCK_CUSTOMERS.filter((c) => c.isActive).length
    const totalCustomerCount = MOCK_CUSTOMERS.length

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
    }
  }, [
    // Dependencies are the imported module-level constants. They don't change
    // at runtime (mock data), but listing them explicitly makes this correct
    // when real API calls replace these imports later.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ])
}
