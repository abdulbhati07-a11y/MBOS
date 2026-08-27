"use client"

// ---------------------------------------------------------------------------
// src/app/(dashboard)/reports/page.tsx
//
// Section 6.11 — reports, wired to the live API.
//
// This page used to compute every figure in the browser: it read
// `OrdersContext` / `ProductsContext` and the `MOCK_*` arrays and summed them
// client-side. That is gone. Each tab now reads a `/reports` endpoint whose
// numbers are derived once, on the server, across the whole table — so the
// figure reconciles against the records behind it and does not shift as a reader
// pages through. See `src/lib/api/reports/queries.ts`.
//
// Two consequences of that move show up throughout this file:
//
//   1. Money arrives in **minor units** (`*Cents`) and is rendered with
//      `formatMoneyMinor`, never `formatMoney` — the latter is the mock-data path
//      and would print a figure 100× too large. The old page used `formatMoney`
//      on major units; every one of those calls has been replaced.
//   2. Totals come from the response's `totals` block, not from `data`. `data` is
//      one page; `totals` describes the whole filtered set. Never re-sum `data`
//      to make a headline — it would total a single page and read as authoritative.
//
// CSV export (`?format=csv` on the four list reports) is deliberately not wired
// here: `api.get` parses JSON, and a browser download of a CSV under the
// in-memory bearer token needs a blob path added to the client layer first. That
// is a separate change; this pass is the read wiring.
// ---------------------------------------------------------------------------

import * as React from "react"
import { ColumnDef } from "@tanstack/react-table"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Lock } from "lucide-react"

import { PageHeader } from "@/components/shared/PageHeader"
import { DataTable } from "@/components/shared/DataTable"
import { StatusBadge } from "@/components/shared/StatusBadge"
import { EmptyState } from "@/components/shared/EmptyState"
import { useBreadcrumb } from "@/contexts/breadcrumb-context"
import { useCanPerform } from "@/contexts/role-context"
import { Modules, Actions } from "@/config/permissions"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

import { formatMoneyMinor } from "@/lib/format/currency"
import { isApiError } from "@/lib/api/client"
import { MAX_PAGE_SIZE } from "@/lib/api/types"
import { ORDER_STATUSES, type OrderStatus } from "@/lib/api/sales/queries"
import {
  fetchSalesSummary,
  fetchSalesOrders,
  fetchInventoryValuation,
  fetchCustomerActivity,
  fetchSupplierSpend,
  reportKeys,
  type SalesOrderRow,
  type InventoryValuationRow,
  type CustomerActivityRow,
  type SupplierSpendRow,
  type InventoryValuationParams,
} from "@/lib/api/reports/queries"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPORTS_CRUMBS = [{ label: "Reports" }] as const

const PAGE_SIZE = 10

const ORDER_STATUS_VARIANTS: Record<OrderStatus, "success" | "warning" | "destructive"> = {
  Completed: "success",
  Pending: "warning",
  Refunded: "destructive",
}

const STOCK_STATUS_VARIANTS: Record<string, "success" | "warning" | "destructive"> = {
  "In Stock": "success",
  "Low Stock": "warning",
  "Out of Stock": "destructive",
}

/** The raw `<select>` styling the inventory page established; reused for parity. */
const SELECT_CLASS =
  "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"

/**
 * The distinct categories the valuation filter offers are derived from one
 * unfiltered valuation read at this size, rather than from `GET /products`.
 *
 * Two reasons it is sourced this way. The category set is user-defined free text,
 * so there is no enum to pick from the way the order-status filter has one. And
 * `GET /products` is gated on `inventory.read` — a *different* permission from the
 * `reports.read` that gates this whole page — so a reports-only user would get a
 * 403 populating a dropdown for a report they are allowed to see. Reading the
 * valuation report itself keeps the dropdown on the same permission as the tab.
 *
 * The bound: only the first `MAX_PAGE_SIZE` products contribute a category, so a
 * category that exists solely on product 101+ would be missing from the list. At
 * this app's scale (a single-branch SMB catalogue) that ceiling is never reached;
 * a dedicated distinct-categories endpoint is the fix if it ever is.
 */
const CATEGORY_SOURCE_PARAMS: InventoryValuationParams = { pageSize: MAX_PAGE_SIZE }

// ---------------------------------------------------------------------------
// Shared presentational helpers
// ---------------------------------------------------------------------------

/** A headline figure. `isLoading` shows a skeleton in place of the value. */
function MetricCard({
  label,
  value,
  hint,
  isLoading,
  valueClassName,
}: {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  isLoading?: boolean
  valueClassName?: string
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-8 w-28" />
        ) : (
          <div className={cn("text-2xl font-bold", valueClassName)}>{value}</div>
        )}
        {hint ? <p className="text-xs text-muted-foreground mt-1">{hint}</p> : null}
      </CardContent>
    </Card>
  )
}

/**
 * The failed-query state every table shares.
 *
 * A 403 is called out separately from a generic failure: it is not a transient
 * error the "Try again" button can clear, so the message says permission rather
 * than inviting a retry that will fail the same way. The page guard below should
 * make a 403 unreachable, but the guard is client-side role state and the server
 * is the authority — so this stays as defence in depth, matching the other pages.
 */
function QueryErrorState({
  error,
  resource,
  onRetry,
}: {
  error: unknown
  resource: string
  onRetry: () => void
}) {
  const forbidden = isApiError(error) && error.isForbidden
  return (
    <div className="space-y-3 py-8 text-center">
      <p role="alert" className="text-sm text-destructive">
        {forbidden
          ? `You do not have permission to view ${resource}.`
          : `Could not load ${resource}.`}
      </p>
      <Button variant="outline" onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}

/**
 * A From/To date-range control. Empty inputs mean all-time — the parent omits an
 * empty bound from the query, and the server treats a missing bound as unbounded.
 *
 * `idPrefix` keeps the `<label htmlFor>` associations unique when two of these
 * render on different tabs of the same page.
 */
function DateRangeFilter({
  idPrefix,
  from,
  to,
  onFrom,
  onTo,
  note,
}: {
  idPrefix: string
  from: string
  to: string
  onFrom: (value: string) => void
  onTo: (value: string) => void
  note?: string
}) {
  return (
    <div className="bg-card border rounded-md p-4">
      <p className="text-sm font-medium mb-3">Date range</p>
      <div className="flex items-end gap-4 flex-wrap">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-from`}>From</Label>
          <Input
            id={`${idPrefix}-from`}
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => onFrom(e.target.value)}
            className="w-40"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-to`}>To</Label>
          <Input
            id={`${idPrefix}-to`}
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => onTo(e.target.value)}
            className="w-40"
          />
        </div>
        <p className="text-xs text-muted-foreground pb-1">
          {note ?? "Leave both empty for all time."}
        </p>
      </div>
    </div>
  )
}

/** ISO timestamp → a medium date, or an em dash for a null/unparseable value. */
function formatDate(value: string | null): string {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString("en-US", { dateStyle: "medium" })
}

const WALK_IN_LABEL = "Walk-in"

// ---------------------------------------------------------------------------
// Sales Summary Tab
// ---------------------------------------------------------------------------

const salesOrderColumns: ColumnDef<SalesOrderRow>[] = [
  {
    accessorKey: "orderNumber",
    header: "Order #",
    cell: ({ row }) => <span className="font-mono font-medium">{row.original.orderNumber}</span>,
  },
  {
    accessorKey: "date",
    header: "Date",
    cell: ({ row }) => formatDate(row.original.date),
  },
  {
    accessorKey: "customerName",
    header: "Customer",
    cell: ({ row }) =>
      row.original.customerName ?? (
        <span className="text-muted-foreground">{WALK_IN_LABEL}</span>
      ),
  },
  { accessorKey: "lineCount", header: "Items" },
  {
    accessorKey: "totalCents",
    header: "Total",
    cell: ({ row }) => formatMoneyMinor(row.original.totalCents),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <StatusBadge status={row.original.status} variantMap={ORDER_STATUS_VARIANTS} />
    ),
  },
  { accessorKey: "paymentMethod", header: "Payment" },
]

function SalesSummaryTab() {
  const [dateFrom, setDateFrom] = React.useState("")
  const [dateTo, setDateTo] = React.useState("")
  const [status, setStatus] = React.useState<OrderStatus | "">("")
  const [pageIndex, setPageIndex] = React.useState(0)

  // Every filter change resets the order table to page 0 at the cause, rather
  // than via an effect that would render the out-of-range page and correct it on
  // a second pass. Same reasoning as the inventory page.
  const changeFrom = (value: string) => {
    setDateFrom(value)
    setPageIndex(0)
  }
  const changeTo = (value: string) => {
    setDateTo(value)
    setPageIndex(0)
  }
  const changeStatus = (value: OrderStatus | "") => {
    setStatus(value)
    setPageIndex(0)
  }

  const summaryParams = React.useMemo(
    () => ({
      ...(dateFrom ? { dateFrom } : {}),
      ...(dateTo ? { dateTo } : {}),
    }),
    [dateFrom, dateTo]
  )

  const ordersParams = React.useMemo(
    () => ({
      pageIndex,
      pageSize: PAGE_SIZE,
      ...(dateFrom ? { dateFrom } : {}),
      ...(dateTo ? { dateTo } : {}),
      ...(status ? { status } : {}),
    }),
    [pageIndex, dateFrom, dateTo, status]
  )

  const summaryQuery = useQuery({
    queryKey: reportKeys.salesSummary(summaryParams),
    queryFn: ({ signal }) => fetchSalesSummary(summaryParams, signal),
    placeholderData: keepPreviousData,
  })

  const ordersQuery = useQuery({
    queryKey: reportKeys.salesOrders(ordersParams),
    queryFn: ({ signal }) => fetchSalesOrders(ordersParams, signal),
    placeholderData: keepPreviousData,
  })

  const summary = summaryQuery.data
  const orders = ordersQuery.data?.data ?? []
  const pageCount = ordersQuery.data?.pagination.pageCount ?? 0

  return (
    <div className="space-y-6">
      <DateRangeFilter
        idPrefix="sales"
        from={dateFrom}
        to={dateTo}
        onFrom={changeFrom}
        onTo={changeTo}
        note="Leave both empty for all time. Branch filtering is not wired yet."
      />

      {/* Headline figures — from `totals`-equivalent summary object, never re-summed here. */}
      {summaryQuery.isError ? (
        <div className="bg-card border rounded-md p-4">
          <QueryErrorState
            error={summaryQuery.error}
            resource="the sales summary"
            onRetry={() => void summaryQuery.refetch()}
          />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              label="Net Sales"
              value={summary ? formatMoneyMinor(summary.netSalesCents) : "—"}
              hint={
                summary
                  ? `${summary.orderCount} order${summary.orderCount === 1 ? "" : "s"} in range`
                  : undefined
              }
              isLoading={summaryQuery.isPending}
            />
            <MetricCard
              label="Gross Sales"
              value={summary ? formatMoneyMinor(summary.grossSalesCents) : "—"}
              hint={summary ? `Tax collected: ${formatMoneyMinor(summary.taxAmountCents)}` : undefined}
              isLoading={summaryQuery.isPending}
            />
            <MetricCard
              label="Refunds"
              value={summary ? formatMoneyMinor(summary.refundsCents) : "—"}
              hint="Returned to customers"
              isLoading={summaryQuery.isPending}
            />
            <MetricCard
              label="Pending"
              value={summary ? formatMoneyMinor(summary.pendingCents) : "—"}
              hint="Not yet concluded"
              isLoading={summaryQuery.isPending}
            />
          </div>

          {summary && (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="bg-card border rounded-md p-4">
                <p className="text-sm font-medium mb-3">By status</p>
                <div className="space-y-2">
                  {summary.byStatus.map((bucket) => (
                    <div key={bucket.status} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{bucket.status}</span>
                      <span className="font-medium">
                        {bucket.orderCount} · {formatMoneyMinor(bucket.totalCents)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="bg-card border rounded-md p-4">
                <p className="text-sm font-medium mb-3">By payment method</p>
                <div className="space-y-2">
                  {summary.byPaymentMethod.map((bucket) => (
                    <div
                      key={bucket.paymentMethod}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="text-muted-foreground">{bucket.paymentMethod}</span>
                      <span className="font-medium">
                        {bucket.orderCount} · {formatMoneyMinor(bucket.totalCents)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Order detail */}
      <div className="bg-card border rounded-md p-4">
        <div className="flex items-center justify-between gap-4 mb-3 flex-wrap">
          <p className="text-sm font-medium">Orders</p>
          <div className="flex items-center gap-2">
            <Label htmlFor="sales-status" className="text-xs text-muted-foreground">
              Status
            </Label>
            <select
              id="sales-status"
              value={status}
              onChange={(e) => changeStatus(e.target.value as OrderStatus | "")}
              className={SELECT_CLASS}
            >
              <option value="">All statuses</option>
              {ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>

        {ordersQuery.isError ? (
          <QueryErrorState
            error={ordersQuery.error}
            resource="orders"
            onRetry={() => void ordersQuery.refetch()}
          />
        ) : (
          <DataTable
            columns={salesOrderColumns}
            data={orders}
            isLoading={ordersQuery.isPending}
            pageIndex={pageIndex}
            pageSize={PAGE_SIZE}
            pageCount={pageCount}
            onPageChange={setPageIndex}
          />
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inventory Valuation Tab
// ---------------------------------------------------------------------------

const valuationColumns: ColumnDef<InventoryValuationRow>[] = [
  {
    id: "product",
    header: "Product",
    cell: ({ row }) => (
      <div className="flex flex-col">
        <span className="font-medium">{row.original.name}</span>
        <span className="text-xs text-muted-foreground">{row.original.sku}</span>
      </div>
    ),
  },
  { accessorKey: "category", header: "Category" },
  {
    id: "stock",
    header: "Stock",
    cell: ({ row }) => {
      const { stock, reorderPoint, uom } = row.original
      // Presentational only. The threshold (at or below reorder point) is the same
      // rule the server counts `lowStockCount` by, so the badge and the totals card
      // agree.
      const label = stock === 0 ? "Out of Stock" : stock <= reorderPoint ? "Low Stock" : "In Stock"
      return (
        <div className="flex items-center gap-2">
          <span>
            {stock} {uom}
          </span>
          <StatusBadge status={label} variantMap={STOCK_STATUS_VARIANTS} />
        </div>
      )
    },
  },
  {
    accessorKey: "priceCents",
    header: "Unit Price",
    cell: ({ row }) => formatMoneyMinor(row.original.priceCents),
  },
  {
    accessorKey: "retailValueCents",
    header: "Retail Value",
    cell: ({ row }) => formatMoneyMinor(row.original.retailValueCents),
  },
  {
    accessorKey: "costValueCents",
    header: "Cost Value",
    cell: ({ row }) => formatMoneyMinor(row.original.costValueCents),
  },
  {
    accessorKey: "marginCents",
    header: "Gross Margin",
    cell: ({ row }) => {
      const margin = row.original.marginCents
      return (
        <span className={margin >= 0 ? "text-success font-medium" : "text-destructive font-medium"}>
          {formatMoneyMinor(margin)}
        </span>
      )
    },
  },
]

function InventoryValuationTab() {
  const [category, setCategory] = React.useState("")
  const [pageIndex, setPageIndex] = React.useState(0)

  const changeCategory = (value: string) => {
    setCategory(value)
    setPageIndex(0)
  }

  const tableParams = React.useMemo<InventoryValuationParams>(
    () => ({
      pageIndex,
      pageSize: PAGE_SIZE,
      ...(category ? { category } : {}),
    }),
    [pageIndex, category]
  )

  const valuationQuery = useQuery({
    queryKey: reportKeys.inventoryValuation(tableParams),
    queryFn: ({ signal }) => fetchInventoryValuation(tableParams, signal),
    placeholderData: keepPreviousData,
  })

  // The dropdown's options come from a separate, unfiltered read — see
  // CATEGORY_SOURCE_PARAMS. It is on the same `reports.read` permission as the
  // table, so if the reader lacks access, both fail together and the table shows
  // the real error; here a failure just leaves the dropdown at "All categories".
  const categoriesQuery = useQuery({
    queryKey: reportKeys.inventoryValuation(CATEGORY_SOURCE_PARAMS),
    queryFn: ({ signal }) => fetchInventoryValuation(CATEGORY_SOURCE_PARAMS, signal),
  })

  const categories = React.useMemo(() => {
    const rows = categoriesQuery.data?.data ?? []
    return Array.from(new Set(rows.map((r) => r.category))).sort()
  }, [categoriesQuery.data])

  const rows = valuationQuery.data?.data ?? []
  const totals = valuationQuery.data?.totals
  const pageCount = valuationQuery.data?.pagination.pageCount ?? 0

  return (
    <div className="space-y-6">
      {/* Category filter */}
      <div className="bg-card border rounded-md p-4">
        <div className="flex items-end gap-4 flex-wrap">
          <div className="space-y-1.5">
            <Label htmlFor="valuation-category">Category</Label>
            <select
              id="valuation-category"
              value={category}
              onChange={(e) => changeCategory(e.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs text-muted-foreground pb-1">
            Values are the current on-hand stock priced at unit price and unit cost.
          </p>
        </div>
      </div>

      {valuationQuery.isError ? (
        <div className="bg-card border rounded-md p-4">
          <QueryErrorState
            error={valuationQuery.error}
            resource="inventory valuation"
            onRetry={() => void valuationQuery.refetch()}
          />
        </div>
      ) : (
        <>
          {/* Totals across the whole filtered set — from `totals`, not the page. */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              label="Retail Value"
              value={totals ? formatMoneyMinor(totals.retailValueCents) : "—"}
              hint={
                totals
                  ? `Across ${totals.productCount} product${totals.productCount === 1 ? "" : "s"}`
                  : undefined
              }
              isLoading={valuationQuery.isPending}
            />
            <MetricCard
              label="Cost Value"
              value={totals ? formatMoneyMinor(totals.costValueCents) : "—"}
              hint="At purchase cost"
              isLoading={valuationQuery.isPending}
            />
            <MetricCard
              label="Gross Margin"
              value={totals ? formatMoneyMinor(totals.marginCents) : "—"}
              hint="Retail minus cost"
              valueClassName={totals && totals.marginCents < 0 ? "text-destructive" : "text-success"}
              isLoading={valuationQuery.isPending}
            />
            <MetricCard
              label="Stock Alerts"
              value={totals ? totals.outOfStockCount + totals.lowStockCount : "—"}
              hint={
                totals
                  ? totals.outOfStockCount + totals.lowStockCount === 0
                    ? "All items in stock"
                    : `${totals.outOfStockCount} out of stock · ${totals.lowStockCount} low`
                  : undefined
              }
              isLoading={valuationQuery.isPending}
            />
          </div>

          <div className="bg-card border rounded-md p-4">
            <p className="text-sm font-medium mb-3">Product valuation</p>
            <DataTable
              columns={valuationColumns}
              data={rows}
              isLoading={valuationQuery.isPending}
              pageIndex={pageIndex}
              pageSize={PAGE_SIZE}
              pageCount={pageCount}
              onPageChange={setPageIndex}
            />
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Customer & Supplier Activity Tab
// ---------------------------------------------------------------------------

const customerColumns: ColumnDef<CustomerActivityRow>[] = [
  {
    accessorKey: "name",
    header: "Customer",
    cell: ({ row }) => (
      <div className="flex items-center gap-2">
        <span className="font-medium">{row.original.name}</span>
        {!row.original.isActive && (
          <StatusBadge status="Inactive" variantMap={{ Inactive: "secondary" }} />
        )}
      </div>
    ),
  },
  { accessorKey: "email", header: "Email" },
  { accessorKey: "orderCount", header: "Orders" },
  {
    accessorKey: "totalSpendCents",
    header: "Total Spend",
    cell: ({ row }) => (
      <span className="font-medium">{formatMoneyMinor(row.original.totalSpendCents)}</span>
    ),
  },
  {
    accessorKey: "refundsCents",
    header: "Refunds",
    cell: ({ row }) => formatMoneyMinor(row.original.refundsCents),
  },
  {
    accessorKey: "lastOrderDate",
    header: "Last Order",
    cell: ({ row }) => formatDate(row.original.lastOrderDate),
  },
]

const supplierColumns: ColumnDef<SupplierSpendRow>[] = [
  {
    accessorKey: "name",
    header: "Supplier",
    cell: ({ row }) => (
      <div className="flex items-center gap-2">
        <span className="font-medium">{row.original.name}</span>
        {!row.original.isActive && (
          <StatusBadge status="Inactive" variantMap={{ Inactive: "secondary" }} />
        )}
      </div>
    ),
  },
  { accessorKey: "poCount", header: "POs" },
  {
    accessorKey: "totalCents",
    header: "Total",
    cell: ({ row }) => formatMoneyMinor(row.original.totalCents),
  },
  {
    accessorKey: "receivedCents",
    header: "Received",
    cell: ({ row }) => (
      <span className="font-medium">{formatMoneyMinor(row.original.receivedCents)}</span>
    ),
  },
  {
    accessorKey: "openCents",
    header: "Open",
    cell: ({ row }) => formatMoneyMinor(row.original.openCents),
  },
  {
    accessorKey: "lastOrderDate",
    header: "Last Order",
    cell: ({ row }) => formatDate(row.original.lastOrderDate),
  },
]

function ActivityTab() {
  // One date range drives both reports — both accept the same bounds.
  const [dateFrom, setDateFrom] = React.useState("")
  const [dateTo, setDateTo] = React.useState("")
  const [customerPage, setCustomerPage] = React.useState(0)
  const [supplierPage, setSupplierPage] = React.useState(0)

  const changeFrom = (value: string) => {
    setDateFrom(value)
    setCustomerPage(0)
    setSupplierPage(0)
  }
  const changeTo = (value: string) => {
    setDateTo(value)
    setCustomerPage(0)
    setSupplierPage(0)
  }

  const customerParams = React.useMemo(
    () => ({
      pageIndex: customerPage,
      pageSize: PAGE_SIZE,
      ...(dateFrom ? { dateFrom } : {}),
      ...(dateTo ? { dateTo } : {}),
    }),
    [customerPage, dateFrom, dateTo]
  )

  const supplierParams = React.useMemo(
    () => ({
      pageIndex: supplierPage,
      pageSize: PAGE_SIZE,
      ...(dateFrom ? { dateFrom } : {}),
      ...(dateTo ? { dateTo } : {}),
    }),
    [supplierPage, dateFrom, dateTo]
  )

  const customerQuery = useQuery({
    queryKey: reportKeys.customerActivity(customerParams),
    queryFn: ({ signal }) => fetchCustomerActivity(customerParams, signal),
    placeholderData: keepPreviousData,
  })

  const supplierQuery = useQuery({
    queryKey: reportKeys.supplierSpend(supplierParams),
    queryFn: ({ signal }) => fetchSupplierSpend(supplierParams, signal),
    placeholderData: keepPreviousData,
  })

  const customerRows = customerQuery.data?.data ?? []
  const customerTotals = customerQuery.data?.totals
  const customerPageCount = customerQuery.data?.pagination.pageCount ?? 0

  const supplierRows = supplierQuery.data?.data ?? []
  const supplierTotals = supplierQuery.data?.totals
  const supplierPageCount = supplierQuery.data?.pagination.pageCount ?? 0

  return (
    <div className="space-y-6">
      <DateRangeFilter
        idPrefix="activity"
        from={dateFrom}
        to={dateTo}
        onFrom={changeFrom}
        onTo={changeTo}
      />

      {/* Customer activity */}
      <div className="bg-card border rounded-md p-4 space-y-3">
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <p className="text-sm font-medium">Customer activity</p>
          {customerTotals && (
            <p className="text-xs text-muted-foreground">
              {customerTotals.buyingCustomerCount} of {customerTotals.customerCount} customers
              bought · net {formatMoneyMinor(customerTotals.totalSpendCents)}
            </p>
          )}
        </div>

        {/* A walk-in sale has no customer, so it appears in no row. Reported here
            explicitly so the rows plus this line reconcile with the sales summary,
            the same reason the CSV export appends a walk-in row. */}
        {customerTotals && customerTotals.walkIn.orderCount > 0 && (
          <p className="text-xs text-muted-foreground">
            Walk-in / no customer: {customerTotals.walkIn.orderCount} order
            {customerTotals.walkIn.orderCount === 1 ? "" : "s"} ·{" "}
            {formatMoneyMinor(customerTotals.walkIn.totalSpendCents)}
          </p>
        )}

        {customerQuery.isError ? (
          <QueryErrorState
            error={customerQuery.error}
            resource="customer activity"
            onRetry={() => void customerQuery.refetch()}
          />
        ) : (
          <DataTable
            columns={customerColumns}
            data={customerRows}
            isLoading={customerQuery.isPending}
            pageIndex={customerPage}
            pageSize={PAGE_SIZE}
            pageCount={customerPageCount}
            onPageChange={setCustomerPage}
          />
        )}
      </div>

      {/* Supplier spend */}
      <div className="bg-card border rounded-md p-4 space-y-3">
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <p className="text-sm font-medium">Supplier spend</p>
          {supplierTotals && (
            <p className="text-xs text-muted-foreground">
              {supplierTotals.activeSupplierCount} of {supplierTotals.supplierCount} suppliers ·{" "}
              {supplierTotals.poCount} PO{supplierTotals.poCount === 1 ? "" : "s"} · received{" "}
              {formatMoneyMinor(supplierTotals.receivedCents)}
            </p>
          )}
        </div>

        {supplierQuery.isError ? (
          <QueryErrorState
            error={supplierQuery.error}
            resource="supplier spend"
            onRetry={() => void supplierQuery.refetch()}
          />
        ) : (
          <DataTable
            columns={supplierColumns}
            data={supplierRows}
            isLoading={supplierQuery.isPending}
            pageIndex={supplierPage}
            pageSize={PAGE_SIZE}
            pageCount={supplierPageCount}
            onPageChange={setSupplierPage}
          />
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ReportsPage() {
  useBreadcrumb("Reports", REPORTS_CRUMBS as unknown as { label: string; href?: string }[])

  // reports.read: Owner and Manager have it, Cashier does not. Every report route
  // is gated on it server-side too; this guard just avoids rendering a page whose
  // every query would 403. Owner and Manager see the same read-only views.
  const canAccess = useCanPerform(Modules.REPORTS, Actions.READ)

  if (!canAccess) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Reports" description="Business analytics and summaries" />
        <EmptyState
          icon={Lock}
          title="Access restricted"
          description="You don't have access to Reports. Contact your manager."
          className="mt-4"
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Reports" description="Business analytics and summaries" />

      <Tabs defaultValue="sales">
        <TabsList>
          <TabsTrigger value="sales">Sales Summary</TabsTrigger>
          <TabsTrigger value="inventory">Inventory Valuation</TabsTrigger>
          <TabsTrigger value="activity">Customer &amp; Supplier Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="sales">
          <SalesSummaryTab />
        </TabsContent>

        <TabsContent value="inventory">
          <InventoryValuationTab />
        </TabsContent>

        <TabsContent value="activity">
          <ActivityTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
