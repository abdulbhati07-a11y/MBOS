"use client"

// ---------------------------------------------------------------------------
// src/contexts/orders-context.tsx
//
// Shared live orders state — same pattern as ProductsContext (Step 11).
//
// OrdersProvider wraps the dashboard layout. SalesPage writes to it when
// NewOrderForm places an order. Reports and use-dashboard-metrics read from
// it so session-placed orders are immediately visible everywhere.
//
// Without this context, orders placed via POS were invisible to Reports'
// Sales Summary and Dashboard's revenue/recent-orders widgets until reload.
// (DEBT-011 — resolved here.)
//
// When a real backend exists, replace the useState initialiser with an
// API fetch. All consumers (useOrders, useSetOrders) require no changes.
// ---------------------------------------------------------------------------

import * as React from "react"
import { MOCK_ORDERS, OrderRecord } from "@/lib/mock-data/orders"

type OrdersContextValue = {
  orders: OrderRecord[]
  setOrders: React.Dispatch<React.SetStateAction<OrderRecord[]>>
}

const OrdersContext = React.createContext<OrdersContextValue | null>(null)

export function OrdersProvider({ children }: { children: React.ReactNode }) {
  const [orders, setOrders] = React.useState<OrderRecord[]>(MOCK_ORDERS)

  const value = React.useMemo(
    () => ({ orders, setOrders }),
    [orders]
  )

  return (
    <OrdersContext.Provider value={value}>{children}</OrdersContext.Provider>
  )
}

function useOrdersContext(): OrdersContextValue {
  const ctx = React.useContext(OrdersContext)
  if (!ctx) {
    throw new Error("useOrdersContext must be used within an OrdersProvider")
  }
  return ctx
}

/** Read the live orders array. */
export function useOrders(): OrderRecord[] {
  return useOrdersContext().orders
}

/** Write to the live orders array. Used only by SalesPage. */
export function useSetOrders(): React.Dispatch<React.SetStateAction<OrderRecord[]>> {
  return useOrdersContext().setOrders
}
