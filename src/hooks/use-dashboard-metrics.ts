"use client"

// ---------------------------------------------------------------------------
// src/hooks/use-dashboard-metrics.ts
//
// The dashboard's data, read from the live API (DEBT-032). This used to derive
// every figure from the mock-backed `OrdersContext` / `ProductsContext` and the
// `MOCK_*` arrays; it now fires three gated reads against the real backend and
// hands the page their loading / error / permission state.
//
// The three sections are gated on DIFFERENT permissions, because the dashboard is
// visible to every role but its data is not: `sales` and `inventory` are readable
// by a Cashier, `reports` (which powers every money total and the PO / supplier /
// customer aggregates) is not. Each section therefore carries its own `canView`,
// and its query is `enabled` only when the role may read it — a disabled query
// never fires, so a Cashier's dashboard makes no request it would be refused.
//
// See `src/lib/api/dashboard/queries.ts` for the composition each snapshot does.
// ---------------------------------------------------------------------------

import { useQuery } from "@tanstack/react-query"

import { useCanPerform } from "@/contexts/role-context"
import { Modules, Actions } from "@/config/permissions"
import {
  dashboardKeys,
  fetchSalesSnapshot,
  fetchInventorySnapshot,
  fetchBusinessSnapshot,
  type SalesSnapshot,
  type InventorySnapshot,
  type BusinessSnapshot,
} from "@/lib/api/dashboard/queries"

export type { DashboardRecentOrder } from "@/lib/api/dashboard/queries"

/**
 * A gated dashboard section. When `canView` is false the section is hidden
 * outright — the page must check it before reading `data`, `isPending` or
 * `isError`, all of which describe a query that never ran.
 */
export interface DashboardSection<T> {
  /** The role holds the permission this section's data requires. */
  canView: boolean
  isPending: boolean
  isError: boolean
  data: T | undefined
  refetch: () => void
}

export interface DashboardMetrics {
  sales: DashboardSection<SalesSnapshot>
  inventory: DashboardSection<InventorySnapshot>
  business: DashboardSection<BusinessSnapshot>
}

export function useDashboardMetrics(): DashboardMetrics {
  const canReadSales = useCanPerform(Modules.SALES, Actions.READ)
  const canReadInventory = useCanPerform(Modules.INVENTORY, Actions.READ)
  const canReadReports = useCanPerform(Modules.REPORTS, Actions.READ)

  const salesQuery = useQuery({
    queryKey: dashboardKeys.sales(),
    queryFn: ({ signal }) => fetchSalesSnapshot(signal),
    enabled: canReadSales,
  })

  const inventoryQuery = useQuery({
    queryKey: dashboardKeys.inventory(),
    queryFn: ({ signal }) => fetchInventorySnapshot(signal),
    enabled: canReadInventory,
  })

  const businessQuery = useQuery({
    queryKey: dashboardKeys.business(),
    queryFn: ({ signal }) => fetchBusinessSnapshot(signal),
    enabled: canReadReports,
  })

  return {
    sales: {
      canView: canReadSales,
      isPending: salesQuery.isPending,
      isError: salesQuery.isError,
      data: salesQuery.data,
      refetch: () => void salesQuery.refetch(),
    },
    inventory: {
      canView: canReadInventory,
      isPending: inventoryQuery.isPending,
      isError: inventoryQuery.isError,
      data: inventoryQuery.data,
      refetch: () => void inventoryQuery.refetch(),
    },
    business: {
      canView: canReadReports,
      isPending: businessQuery.isPending,
      isError: businessQuery.isError,
      data: businessQuery.data,
      refetch: () => void businessQuery.refetch(),
    },
  }
}
