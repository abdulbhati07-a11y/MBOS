"use client"

import * as React from "react"
import Link from "next/link"
import { ColumnDef } from "@tanstack/react-table"
import {
  ShoppingCart,
  Users,
  Package,
  UserPlus,
  BarChart3,
  Plus,
  Truck,
  Building2,
  AlertTriangle,
} from "lucide-react"

import { PageHeader } from "@/components/shared/PageHeader"
import { DataTable } from "@/components/shared/DataTable"
import { StatusBadge } from "@/components/shared/StatusBadge"
import { useBreadcrumb } from "@/contexts/breadcrumb-context"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

import { useDashboardMetrics, RecentOrderRow } from "@/hooks/use-dashboard-metrics"
import { OrderStatus } from "@/lib/mock-data/orders"
import { POStatus } from "@/lib/mock-data/purchase-orders"
import { formatMoney } from "@/lib/format/currency"
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const DASHBOARD_CRUMBS = [{ label: "Dashboard" }] as const

const ORDER_STATUS_VARIANTS: Record<OrderStatus, "success" | "warning" | "destructive"> = {
  Completed: "success",
  Pending:   "warning",
  Refunded:  "destructive",
}

const PO_STATUS_VARIANTS: Record<POStatus, "secondary" | "warning" | "success" | "destructive"> = {
  Draft:     "secondary",
  Sent:      "warning",
  Received:  "success",
  Cancelled: "destructive",
}

// ---------------------------------------------------------------------------
// Recent Orders columns
// customerName is always present on OrderRecord (never undefined).
// customerId may be null for POS-created unlinked orders — handled by showing
// customerName as-is without attempting a customer lookup or crashing.
// ---------------------------------------------------------------------------
const recentOrderColumns: ColumnDef<RecentOrderRow>[] = [
  {
    accessorKey: "orderNumber",
    header: "Order",
    cell: ({ row }) => (
      <span className="font-mono font-medium">{row.original.orderNumber}</span>
    ),
  },
  {
    accessorKey: "customerName",
    header: "Customer",
    cell: ({ row }) => {
      const { customerName, customerId } = row.original
      return (
        <span>
          {customerName}
          {customerId === null && (
            <span className="ml-1 text-xs text-muted-foreground">(unlinked)</span>
          )}
        </span>
      )
    },
  },
  {
    accessorKey: "date",
    header: "Date",
    cell: ({ row }) =>
      new Date(row.original.date).toLocaleDateString("en-US", {
        dateStyle: "medium",
      }),
  },
  {
    accessorKey: "total",
    header: "Total",
    cell: ({ row }) => (
      <span className="font-medium">{formatMoney(row.original.total)}</span>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <StatusBadge
        status={row.original.status}
        variantMap={ORDER_STATUS_VARIANTS}
      />
    ),
  },
]

// ---------------------------------------------------------------------------
// Quick Actions
// ---------------------------------------------------------------------------
const quickActions = [
  { label: "New Sale",      href: "/sales",      icon: Plus    },
  { label: "Add Product",   href: "/inventory",  icon: Package },
  { label: "New Customer",  href: "/customers",  icon: UserPlus },
  { label: "View Reports",  href: "/reports",    icon: BarChart3 },
]

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function DashboardPage() {
  useBreadcrumb("Dashboard", DASHBOARD_CRUMBS as unknown as { label: string; href?: string }[])

  const {
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
  } = useDashboardMetrics()

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Dashboard"
        description="Overview of your business at a glance"
      />

      {/* ── KPI Metric Cards ── */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">

        {/* Widget 1 — Open Purchase Orders */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Open Purchase Orders
            </CardTitle>
            <Truck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{openPOCount}</div>
            <div className="mt-2 flex flex-wrap gap-1">
              {poStatusBreakdown
                .filter((s) => !s.isTerminal && s.count > 0)
                .map((s) => (
                  <StatusBadge
                    key={s.status}
                    status={`${s.status} (${s.count})`}
                    variantMap={{ [`${s.status} (${s.count})`]: PO_STATUS_VARIANTS[s.status] }}
                  />
                ))}
              {openPOCount === 0 && (
                <span className="text-xs text-muted-foreground">No open POs</span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Widget 2 — Active Suppliers */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Active Suppliers
            </CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeSupplierCount}</div>
            <p className="text-xs text-muted-foreground mt-1">
              of {totalSupplierCount} total supplier{totalSupplierCount !== 1 ? "s" : ""}
            </p>
          </CardContent>
        </Card>

        {/* Widget 3 — Sales Summary */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Sales
            </CardTitle>
            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatMoney(totalOrderValue)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {totalOrderCount} order{totalOrderCount !== 1 ? "s" : ""}
            </p>
          </CardContent>
        </Card>

        {/* Widget 4 — Active Customers */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Active Customers
            </CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeCustomerCount}</div>
            <p className="text-xs text-muted-foreground mt-1">
              of {totalCustomerCount} total customer{totalCustomerCount !== 1 ? "s" : ""}
            </p>
          </CardContent>
        </Card>

        {/* Widget 5 — Inventory Health (live from ProductsContext) */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Inventory Health
            </CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalProductCount}</div>
            <p className="text-xs text-muted-foreground mt-1">
              product{totalProductCount !== 1 ? "s" : ""}
            </p>
            {(lowStockCount > 0 || outOfStockCount > 0) && (
              <div className="mt-2 flex flex-col gap-0.5">
                {outOfStockCount > 0 && (
                  <span className="text-xs text-destructive font-medium">
                    {outOfStockCount} out of stock
                  </span>
                )}
                {lowStockCount > 0 && (
                  <span className="text-xs text-warning font-medium">
                    {lowStockCount} low stock
                  </span>
                )}
              </div>
            )}
            {lowStockCount === 0 && outOfStockCount === 0 && (
              <p className="text-xs text-success mt-1">All items in stock</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* TODO: FR-AI-03 — Health Score Card and AI Insights list will be added here once AI backend exists */}

      {/* ── Two-column layout ── */}
      <div className="grid gap-6 grid-cols-1 lg:grid-cols-5">

        {/* Left — Recent Orders */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Recent Orders</CardTitle>
            <CardDescription>
              5 most recent sales orders.
              Orders marked "(unlinked)" were created via POS without a customer
              selection — they show the entered name but are not linked to a
              CustomerRecord. (DEBT-004)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={recentOrderColumns}
              data={recentOrders}
              pageCount={1}
              pageIndex={0}
              pageSize={5}
            />
          </CardContent>
        </Card>

        {/* Right column */}
        <div className="lg:col-span-2 flex flex-col gap-6">

          {/* PO Status Breakdown */}
          <Card>
            <CardHeader>
              <CardTitle>PO Status Breakdown</CardTitle>
              <CardDescription>All purchase orders by status</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {poStatusBreakdown.map((s) => (
                  <div key={s.status} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <StatusBadge
                        status={s.status}
                        variantMap={PO_STATUS_VARIANTS}
                      />
                      {s.isTerminal && (
                        <span className="text-xs text-muted-foreground">terminal</span>
                      )}
                    </div>
                    <span className="font-medium tabular-nums">{s.count}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              {quickActions.map((action) => (
                <Button
                  key={action.label}
                  variant="outline"
                  className="h-auto flex flex-col items-center gap-2 py-4"
                  // Link renders an <a>, not a native <button>. Base UI's
                  // nativeButton defaults to true, so it must be turned off
                  // here or it strips the button semantics it assumes.
                  nativeButton={false}
                  render={<Link href={action.href} />}
                >
                  <action.icon className="h-5 w-5" />
                  <span className="text-xs">{action.label}</span>
                </Button>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
