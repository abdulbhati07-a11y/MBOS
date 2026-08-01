"use client"

import * as React from "react"
import { ColumnDef } from "@tanstack/react-table"
import { Lock, AlertTriangle } from "lucide-react"

import { PageHeader } from "@/components/shared/PageHeader"
import { DataTable } from "@/components/shared/DataTable"
import { StatusBadge } from "@/components/shared/StatusBadge"
import { EmptyState } from "@/components/shared/EmptyState"
import { useBreadcrumb } from "@/contexts/breadcrumb-context"
import { useCanPerform } from "@/contexts/role-context"
import { Modules, Actions } from "@/config/permissions"
import { useProducts } from "@/contexts/products-context"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import {
  OrderRecord,
  OrderStatus,
  PaymentMethod,
} from "@/lib/mock-data/orders"
// DEBT-011 resolved: orders now read from OrdersContext (live shared state).
// Session-placed orders are immediately visible in Reports.

import {
  MOCK_CUSTOMERS,
} from "@/lib/mock-data/customers"
import {
  MOCK_PURCHASE_ORDERS,
} from "@/lib/mock-data/purchase-orders"
import { MOCK_SUPPLIERS } from "@/lib/mock-data/suppliers"
import { ProductRecord } from "@/lib/mock-data/products"
import { useOrders } from "@/contexts/orders-context"
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const REPORTS_CRUMBS = [{ label: "Reports" }] as const

const ORDER_STATUS_VARIANTS: Record<OrderStatus, "success" | "warning" | "destructive"> = {
  Completed: "success",
  Pending:   "warning",
  Refunded:  "destructive",
}

// ---------------------------------------------------------------------------
// Helper — format date input value to/from ISO
// ---------------------------------------------------------------------------
function toDateInputValue(iso: string): string {
  return iso.slice(0, 10)
}

// ---------------------------------------------------------------------------
// Sales Summary Tab
// ---------------------------------------------------------------------------
function SalesSummaryTab() {
  const orders = useOrders() // live from OrdersContext — reflects POS-placed orders

  // Date range defaults: earliest and latest order dates in seed data
  const [startDate, setStartDate] = React.useState("2026-07-01")
  const [endDate, setEndDate] = React.useState("2026-07-31")

  // Filter live orders by date range (inclusive)
  const filtered = React.useMemo(() => {
    const start = new Date(startDate + "T00:00:00Z").getTime()
    const end   = new Date(endDate   + "T23:59:59Z").getTime()
    return orders.filter((o) => {
      const t = new Date(o.date).getTime()
      return t >= start && t <= end
    })
  }, [startDate, endDate, orders])

  // Summary metrics
  const totalRevenue   = filtered.reduce((s, o) => s + o.total, 0)
  const totalSubtotal  = filtered.reduce((s, o) => s + o.subtotal, 0)
  const totalTax       = filtered.reduce((s, o) => s + o.taxAmount, 0)
  const orderCount     = filtered.length
  const completedCount = filtered.filter((o) => o.status === "Completed").length
  const refundedCount  = filtered.filter((o) => o.status === "Refunded").length
  const pendingCount   = filtered.filter((o) => o.status === "Pending").length

  // Payment method breakdown
  const byPayment = (["Cash", "Card", "Mobile"] as PaymentMethod[]).map((m) => ({
    method: m,
    count: filtered.filter((o) => o.paymentMethod === m).length,
    total: filtered.filter((o) => o.paymentMethod === m).reduce((s, o) => s + o.total, 0),
  }))

  // Table columns for filtered orders
  const orderColumns: ColumnDef<OrderRecord>[] = [
    {
      accessorKey: "orderNumber",
      header: "Order #",
      cell: ({ row }) => <span className="font-mono font-medium">{row.original.orderNumber}</span>,
    },
    {
      accessorKey: "date",
      header: "Date",
      cell: ({ row }) => new Date(row.original.date).toLocaleDateString("en-US", { dateStyle: "medium" }),
    },
    { accessorKey: "customerName", header: "Customer" },
    {
      accessorKey: "total",
      header: "Total",
      cell: ({ row }) => `$${row.original.total.toFixed(2)}`,
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

  return (
    <div className="space-y-6">
      {/* Date range filter — FR-REP-02 (date). Branch filter BLOCKED: no branch field on OrderRecord. */}
      <div className="bg-card border rounded-md p-4">
        <p className="text-sm font-medium mb-3">Date Range</p>
        <div className="flex items-end gap-4 flex-wrap">
          <div className="space-y-1.5">
            <Label htmlFor="startDate">From</Label>
            <Input
              id="startDate"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-40"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="endDate">To</Label>
            <Input
              id="endDate"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-40"
            />
          </div>
          <p className="text-xs text-muted-foreground pb-1">
            Branch filter not available — no branch data in current data model.
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Revenue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${totalRevenue.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground mt-1">{orderCount} order{orderCount !== 1 ? "s" : ""}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Net Sales</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${totalSubtotal.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground mt-1">Tax collected: ${totalTax.toFixed(2)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Completed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{completedCount}</div>
            <p className="text-xs text-muted-foreground mt-1">Pending: {pendingCount} · Refunded: {refundedCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">By Payment</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 mt-1">
              {byPayment.filter((p) => p.count > 0).map((p) => (
                <div key={p.method} className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{p.method}</span>
                  <span className="font-medium">{p.count} · ${p.total.toFixed(2)}</span>
                </div>
              ))}
              {byPayment.every((p) => p.count === 0) && (
                <p className="text-xs text-muted-foreground">No orders in range</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Order detail table */}
      <div className="bg-card border rounded-md p-4">
        <p className="text-sm font-medium mb-3">Orders in Range ({filtered.length})</p>
        <DataTable
          columns={orderColumns}
          data={filtered}
          pageCount={1}
          pageIndex={0}
          pageSize={10}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inventory Valuation Tab
// ---------------------------------------------------------------------------
function InventoryValuationTab() {
  const products = useProducts() // live from ProductsContext
  const [categoryFilter, setCategoryFilter] = React.useState("All")

  // categories derived without useMemo — intentional simplicity choice at
  // current data scale (8 products). useDashboardMetrics uses useMemo([products])
  // for the same pattern; both are correct. Add useMemo here if product count grows.
  const categories = React.useMemo(() => {
    const cats = Array.from(new Set(products.map((p) => p.category))).sort()
    return ["All", ...cats]
  }, [products])

  const filtered = categoryFilter === "All"
    ? products
    : products.filter((p) => p.category === categoryFilter)

  // Valuation totals
  const totalRetailValue = filtered.reduce((s, p) => s + p.price * p.stock, 0)
  const totalCostValue   = filtered.reduce((s, p) => s + p.cost  * p.stock, 0)
  const grossMargin      = totalRetailValue - totalCostValue
  const lowStock         = filtered.filter((p) => p.stock > 0 && p.stock <= p.reorderPoint)
  const outOfStock       = filtered.filter((p) => p.stock === 0)

  type ValuationRow = ProductRecord & { retailValue: number; costValue: number; margin: number }

  const valuationColumns: ColumnDef<ValuationRow>[] = [
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
        const p = row.original
        const statusKey = p.stock === 0 ? "out" : p.stock <= p.reorderPoint ? "low" : "in"
        const variantMap = { out: "destructive" as const, low: "warning" as const, in: "success" as const }
        return (
          <div className="flex items-center gap-2">
            <span>{p.stock} {p.uom}</span>
            <StatusBadge status={statusKey} variantMap={variantMap} />
          </div>
        )
      },
    },
    {
      id: "retailValue",
      header: "Retail Value",
      cell: ({ row }) => `$${row.original.retailValue.toFixed(2)}`,
    },
    {
      id: "costValue",
      header: "Cost Value",
      cell: ({ row }) => `$${row.original.costValue.toFixed(2)}`,
    },
    {
      id: "margin",
      header: "Gross Margin",
      cell: ({ row }) => {
        const m = row.original.margin
        return (
          <span className={m >= 0 ? "text-success font-medium" : "text-destructive font-medium"}>
            ${m.toFixed(2)}
          </span>
        )
      },
    },
  ]

  const valuationData: ValuationRow[] = filtered.map((p) => ({
    ...p,
    retailValue: p.price * p.stock,
    costValue:   p.cost  * p.stock,
    margin:      (p.price - p.cost) * p.stock,
  }))

  return (
    <div className="space-y-6">
      {/* Category filter */}
      <div className="bg-card border rounded-md p-4">
        <div className="flex items-end gap-4 flex-wrap">
          <div className="space-y-1.5">
            <Label htmlFor="categoryFilter">Category</Label>
            <select
              id="categoryFilter"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <p className="text-xs text-muted-foreground pb-1">
            Values reflect live inventory state from ProductsContext.
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Retail Value</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${totalRetailValue.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground mt-1">At selling price</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Cost Value</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${totalCostValue.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground mt-1">At purchase cost</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Gross Margin</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-success">${grossMargin.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground mt-1">Retail minus cost</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Stock Alerts</CardTitle>
          </CardHeader>
          <CardContent>
            {outOfStock.length > 0 && (
              <p className="text-xs text-destructive font-medium">{outOfStock.length} out of stock</p>
            )}
            {lowStock.length > 0 && (
              <p className="text-xs text-warning font-medium">{lowStock.length} low stock</p>
            )}
            {outOfStock.length === 0 && lowStock.length === 0 && (
              <p className="text-xs text-success font-medium">All items in stock</p>
            )}
            <div className="text-2xl font-bold mt-1">
              {outOfStock.length + lowStock.length}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Per-product table */}
      <div className="bg-card border rounded-md p-4">
        <p className="text-sm font-medium mb-3">Product Valuation ({filtered.length} products)</p>
        <DataTable
          columns={valuationColumns}
          data={valuationData}
          pageCount={1}
          pageIndex={0}
          pageSize={10}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Customer & Supplier Activity Tab
// ---------------------------------------------------------------------------
function ActivityTab() {
  const orders = useOrders() // live from OrdersContext

  // Customer activity — derived from live orders via customerId FK
  // DEBT-010: no ledger concept (balance, credit, invoices) — spend summary only
  type CustomerRow = {
    id: string
    name: string
    isActive: boolean
    totalOrders: number
    totalSpend: number
  }

  const customerRows: CustomerRow[] = MOCK_CUSTOMERS.map((c) => {
    // Derive directly from live orders — not via getCustomerStats() which reads
    // the static MOCK_ORDERS constant
    const matched = orders.filter((o) => o.customerId === c.id)
    return {
      id: c.id,
      name: c.name,
      isActive: c.isActive,
      totalOrders: matched.length,
      totalSpend: matched.reduce((s, o) => s + o.total, 0),
    }
  }).sort((a, b) => b.totalSpend - a.totalSpend)

  const customerColumns: ColumnDef<CustomerRow>[] = [
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
    { accessorKey: "totalOrders", header: "Orders" },
    {
      accessorKey: "totalSpend",
      header: "Total Spend",
      cell: ({ row }) => <span className="font-medium">${row.original.totalSpend.toFixed(2)}</span>,
    },
  ]

  // Supplier spend — derived from MOCK_PURCHASE_ORDERS by supplierName
  // (POs are not in shared state yet — still reads static seed data)
  // TODO: PROV-FR-PUR-03 — replace supplierName match with supplier ID FK
  type SupplierRow = {
    name: string
    isActive: boolean
    poCount: number
    totalSpend: number
    receivedSpend: number
  }

  const allSupplierNames = Array.from(
    new Set(MOCK_PURCHASE_ORDERS.map((po) => po.supplierName))
  )

  const supplierRows: SupplierRow[] = allSupplierNames.map((name) => {
    const pos = MOCK_PURCHASE_ORDERS.filter((po) => po.supplierName === name)
    const received = pos.filter((po) => po.status === "Received")
    // isActive: look up by name (string match — same limitation as PROV-FR-PUR-03)
    const supplier = MOCK_SUPPLIERS.find((s) => s.name === name)
    return {
      name,
      isActive: supplier?.isActive ?? true,
      poCount: pos.length,
      totalSpend: pos.reduce((s, po) => s + po.total, 0),
      receivedSpend: received.reduce((s, po) => s + po.total, 0),
    }
  }).sort((a, b) => b.totalSpend - a.totalSpend)

  const supplierColumns: ColumnDef<SupplierRow>[] = [
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
      accessorKey: "totalSpend",
      header: "Total PO Value",
      cell: ({ row }) => `$${row.original.totalSpend.toFixed(2)}`,
    },
    {
      accessorKey: "receivedSpend",
      header: "Received Value",
      cell: ({ row }) => <span className="font-medium">${row.original.receivedSpend.toFixed(2)}</span>,
    },
  ]

  return (
    <div className="space-y-6">
      <div className="rounded-md bg-muted/50 border px-4 py-3 text-xs text-muted-foreground">
        This tab shows spend summaries derived from order/PO history.
        A financial ledger (balances, credit terms, invoice aging) is not yet available —
        it requires backend financial data. See DEBT-010.
      </div>

      {/* Customer activity */}
      <div className="bg-card border rounded-md p-4">
        <p className="text-sm font-medium mb-3">Customer Activity (by spend)</p>
        <DataTable
          columns={customerColumns}
          data={customerRows}
          pageCount={1}
          pageIndex={0}
          pageSize={10}
        />
      </div>

      {/* Supplier spend */}
      <div className="bg-card border rounded-md p-4">
        <p className="text-sm font-medium mb-3">Supplier Spend Summary</p>
        <DataTable
          columns={supplierColumns}
          data={supplierRows}
          pageCount={1}
          pageIndex={0}
          pageSize={10}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function ReportsPage() {
  useBreadcrumb("Reports", REPORTS_CRUMBS as unknown as { label: string; href?: string }[])

  // Owner = rwd (write/delete are forward-looking scaffolding, not exercised here)
  // Manager = r
  // Cashier = no access
  // Both Owner and Manager see identical read-only views in this pass.
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
      <PageHeader
        title="Reports"
        description="Business analytics and summaries"
      />

      {/* FR-REP-03 export and FR-REP-04 AI insights are out of scope this pass.
          See DEBT-009 (export) and the Dashboard FR-AI-03 comment. */}

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
