"use client"

// ---------------------------------------------------------------------------
// src/app/(dashboard)/dashboard/page.tsx
//
// The landing dashboard, wired to the live API (DEBT-032). It reads nothing from
// the mock arrays or the mock-backed contexts any more — every figure comes from
// `useDashboardMetrics`, which fires three permission-gated reads.
//
// The page is built to DEGRADE by role, not to gate wholesale. `dashboard` is a
// READ every role has, but the data behind the widgets is not: a Cashier may read
// sales and inventory but not `reports` (the money totals, PO / supplier /
// customer aggregates) — so those cards simply do not render for them, while the
// orders, inventory and quick-action widgets they CAN read still do. Each section
// checks its own `canView` before it touches loading or error state.
//
// Money is minor units (paisa): `formatMoneyMinor`, never `formatMoney` — the
// latter is the old mock path and would print a figure 100× too large.
// ---------------------------------------------------------------------------

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
  TrendingUp,
  type LucideIcon,
} from "lucide-react"

import { PageHeader } from "@/components/shared/PageHeader"
import { DataTable } from "@/components/shared/DataTable"
import { StatusBadge } from "@/components/shared/StatusBadge"
import { useBreadcrumb } from "@/contexts/breadcrumb-context"
import { useCanPerform } from "@/contexts/role-context"
import { Modules, Actions } from "@/config/permissions"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

import { useDashboardMetrics, type DashboardRecentOrder } from "@/hooks/use-dashboard-metrics"
import {
  PO_STATUSES,
  type OrderStatus,
  type POStatus,
} from "@/lib/api/dashboard/queries"
import { formatMoneyMinor } from "@/lib/format/currency"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const DASHBOARD_CRUMBS = [{ label: "Dashboard" }] as const

const ORDER_STATUS_VARIANTS: Record<OrderStatus, "success" | "warning" | "destructive"> = {
  Completed: "success",
  Pending: "warning",
  Refunded: "destructive",
}

const PO_STATUS_VARIANTS: Record<POStatus, "secondary" | "warning" | "success" | "destructive"> = {
  Draft: "secondary",
  Sent: "warning",
  Received: "success",
  Cancelled: "destructive",
}

// ---------------------------------------------------------------------------
// Recent Orders columns
//
// `customerName` is `null` for a walk-in (POS sale with no customer selected) —
// rendered as "Walk-in", matching the Reports page, rather than left blank.
// `totalCents` is minor units: `formatMoneyMinor`.
// ---------------------------------------------------------------------------
const recentOrderColumns: ColumnDef<DashboardRecentOrder>[] = [
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
    cell: ({ row }) =>
      row.original.customerName ?? (
        <span className="text-muted-foreground">Walk-in</span>
      ),
  },
  {
    accessorKey: "date",
    header: "Date",
    cell: ({ row }) =>
      new Date(row.original.date).toLocaleDateString("en-US", { dateStyle: "medium" }),
  },
  {
    accessorKey: "totalCents",
    header: "Total",
    cell: ({ row }) => (
      <span className="font-medium">{formatMoneyMinor(row.original.totalCents)}</span>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <StatusBadge status={row.original.status} variantMap={ORDER_STATUS_VARIANTS} />
    ),
  },
]

// ---------------------------------------------------------------------------
// Presentational helpers
// ---------------------------------------------------------------------------

/** A KPI figure with an icon. `isLoading` swaps the value for a skeleton. */
function MetricCard({
  label,
  icon: Icon,
  value,
  hint,
  isLoading,
}: {
  label: string
  icon: LucideIcon
  value: React.ReactNode
  hint?: React.ReactNode
  isLoading?: boolean
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <div className="text-2xl font-bold">{value}</div>
        )}
        {hint ? <p className="text-xs text-muted-foreground mt-1">{hint}</p> : null}
      </CardContent>
    </Card>
  )
}

/** The one-line, retryable failure state a section shows in place of its data. */
function SectionError({ resource, onRetry }: { resource: string; onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-destructive/10 px-3 py-2">
      <p role="alert" className="text-sm text-destructive">
        Could not load {resource}.
      </p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function DashboardPage() {
  useBreadcrumb("Dashboard", DASHBOARD_CRUMBS as unknown as { label: string; href?: string }[])

  const { sales, inventory, business } = useDashboardMetrics()

  // Quick actions link into modules the role may not be able to act in; each is
  // shown only when the role holds the permission its destination needs, so the
  // grid never offers a Cashier a link to a screen that would turn them away.
  const canCreateSale = useCanPerform(Modules.SALES, Actions.WRITE)
  const canAddProduct = useCanPerform(Modules.INVENTORY, Actions.WRITE)
  const canAddCustomer = useCanPerform(Modules.CUSTOMERS, Actions.WRITE)
  const canViewReports = useCanPerform(Modules.REPORTS, Actions.READ)

  const quickActions = [
    { label: "New Sale", href: "/sales", icon: Plus, show: canCreateSale },
    { label: "Add Product", href: "/inventory", icon: Package, show: canAddProduct },
    { label: "New Customer", href: "/customers", icon: UserPlus, show: canAddCustomer },
    { label: "View Reports", href: "/reports", icon: BarChart3, show: canViewReports },
  ].filter((a) => a.show)

  const b = business.data
  const openByStatus = (status: POStatus) =>
    b?.poByStatus.find((s) => s.status === status)?.poCount ?? 0

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Dashboard" description="Overview of your business at a glance" />

      {/* Section errors — surfaced above the cards so a failed read is never a
          silently blank widget. */}
      {(sales.canView && sales.isError) ||
      (inventory.canView && inventory.isError) ||
      (business.canView && business.isError) ? (
        <div className="flex flex-col gap-2">
          {sales.canView && sales.isError && (
            <SectionError resource="orders" onRetry={sales.refetch} />
          )}
          {inventory.canView && inventory.isError && (
            <SectionError resource="inventory" onRetry={inventory.refetch} />
          )}
          {business.canView && business.isError && (
            <SectionError resource="business metrics" onRetry={business.refetch} />
          )}
        </div>
      ) : null}

      {/* ── KPI cards ── */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-3">
        {sales.canView && (
          <MetricCard
            label="Orders"
            icon={ShoppingCart}
            value={sales.data ? sales.data.totalOrderCount : "—"}
            hint="All time"
            isLoading={sales.isPending}
          />
        )}

        {business.canView && (
          <>
            <MetricCard
              label="Net Sales"
              icon={TrendingUp}
              value={b ? formatMoneyMinor(b.netSalesCents) : "—"}
              hint={b ? `Gross ${formatMoneyMinor(b.grossSalesCents)}` : undefined}
              isLoading={business.isPending}
            />
            <MetricCard
              label="Open Purchase Orders"
              icon={Truck}
              value={b ? b.openPOCount : "—"}
              hint={
                b
                  ? `${openByStatus("Draft")} draft · ${openByStatus("Sent")} sent`
                  : undefined
              }
              isLoading={business.isPending}
            />
            <MetricCard
              label="Suppliers"
              icon={Building2}
              value={b ? b.supplierCount : "—"}
              hint={b ? `${b.poCount} PO${b.poCount === 1 ? "" : "s"} raised` : undefined}
              isLoading={business.isPending}
            />
            <MetricCard
              label="Customers"
              icon={Users}
              value={b ? b.customerCount : "—"}
              hint="Registered"
              isLoading={business.isPending}
            />
          </>
        )}

        {inventory.canView && (
          <MetricCard
            label="Inventory Health"
            icon={AlertTriangle}
            value={inventory.data ? inventory.data.totalProductCount : "—"}
            hint={
              inventory.data
                ? inventory.data.lowStockCount + inventory.data.outOfStockCount === 0
                  ? "All items in stock"
                  : `${inventory.data.outOfStockCount} out of stock · ${inventory.data.lowStockCount} low`
                : undefined
            }
            isLoading={inventory.isPending}
          />
        )}
      </div>

      {/* ── Two-column layout ── */}
      <div className="grid gap-6 grid-cols-1 lg:grid-cols-5">
        {/* Left — Recent Orders */}
        {sales.canView && (
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle>Recent Orders</CardTitle>
              <CardDescription>
                The five most recent sales orders. &ldquo;Walk-in&rdquo; marks a POS
                sale placed without a customer selected.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {sales.isError ? (
                <SectionError resource="recent orders" onRetry={sales.refetch} />
              ) : (
                <DataTable
                  columns={recentOrderColumns}
                  data={sales.data?.recentOrders ?? []}
                  isLoading={sales.isPending}
                  pageCount={1}
                  pageIndex={0}
                  pageSize={5}
                />
              )}
            </CardContent>
          </Card>
        )}

        {/* Right column */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          {/* PO Status Breakdown — reports-gated, so hidden for a Cashier. */}
          {business.canView && (
            <Card>
              <CardHeader>
                <CardTitle>PO Status Breakdown</CardTitle>
                <CardDescription>All purchase orders by status</CardDescription>
              </CardHeader>
              <CardContent>
                {business.isError ? (
                  <SectionError resource="purchase orders" onRetry={business.refetch} />
                ) : business.isPending ? (
                  <div className="space-y-2">
                    {PO_STATUSES.map((s) => (
                      <Skeleton key={s} className="h-6 w-full" />
                    ))}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {(b?.poByStatus ?? []).map((s) => (
                      <div key={s.status} className="flex items-center justify-between text-sm">
                        <StatusBadge status={s.status} variantMap={PO_STATUS_VARIANTS} />
                        <span className="font-medium tabular-nums">{s.poCount}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Quick Actions */}
          {quickActions.length > 0 && (
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
                    // nativeButton defaults to true, so it must be turned off here
                    // or it strips the button semantics it assumes.
                    nativeButton={false}
                    render={<Link href={action.href} />}
                  >
                    <action.icon className="h-5 w-5" />
                    <span className="text-xs">{action.label}</span>
                  </Button>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
