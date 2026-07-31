"use client"

import * as React from "react"
import { ColumnDef } from "@tanstack/react-table"
import { Eye, RotateCcw } from "lucide-react"

import { PageHeader } from "@/components/shared/PageHeader"
import { DataTable } from "@/components/shared/DataTable"
import { StatusBadge } from "@/components/shared/StatusBadge"
import { useBreadcrumb } from "@/contexts/breadcrumb-context"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { useCanPerform } from "@/contexts/role-context"
import { Modules, Actions } from "@/config/permissions"

import { OrderDetailDialog } from "@/components/sales/OrderDetailDialog"
import { NewOrderForm } from "@/components/sales/NewOrderForm"
import { MOCK_ORDERS, OrderRecord, OrderStatus } from "@/lib/mock-data/orders"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const SALES_CRUMBS = [{ label: "Sales" }] as const

const ORDER_STATUS_VARIANTS: Record<OrderStatus, "success" | "warning" | "destructive"> = {
  Completed: "success",
  Pending: "warning",
  Refunded: "destructive",
}

const PAGE_SIZE = 10

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------
export default function SalesPage() {
  useBreadcrumb("Sales", SALES_CRUMBS as unknown as { label: string; href?: string }[])

  const canRefund = useCanPerform(Modules.SALES, Actions.REFUND)

  // Order History state
  const [orders, setOrders] = React.useState<OrderRecord[]>(MOCK_ORDERS)
  const [pageIndex, setPageIndex] = React.useState(0)
  const [detailOrder, setDetailOrder] = React.useState<OrderRecord | null>(null)
  const [detailOpen, setDetailOpen] = React.useState(false)

  // Paginated slice
  const pageCount = Math.ceil(orders.length / PAGE_SIZE)
  const pagedOrders = orders.slice(pageIndex * PAGE_SIZE, (pageIndex + 1) * PAGE_SIZE)

  // ---------------------------------------------------------------------------
  // Refund action — [PROV-FR-SALE-05]
  // Status-flip only. No inventory reversal at this stage.
  // TODO: PROV-FR-SALE-05 — refund should trigger inventory restock when backend exists
  // ---------------------------------------------------------------------------
  const handleRefund = (orderId: string) => {
    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, status: "Refunded" as OrderStatus } : o))
    )
  }

  // ---------------------------------------------------------------------------
  // New order placed callback — prepend to list, switch to history tab
  // ---------------------------------------------------------------------------
  const [activeTab, setActiveTab] = React.useState<string>("history")

  const handleOrderPlaced = (order: OrderRecord) => {
    setOrders((prev) => [order, ...prev])
    setPageIndex(0)
    setActiveTab("history")
  }

  // ---------------------------------------------------------------------------
  // Order History columns — [PROV-FR-SALE-01]
  // ---------------------------------------------------------------------------
  const columns = React.useMemo<ColumnDef<OrderRecord>[]>(
    () => {
      const cols: ColumnDef<OrderRecord>[] = [
        {
          accessorKey: "orderNumber",
          header: "Order #",
          cell: ({ row }) => (
            <span className="font-medium font-mono">{row.original.orderNumber}</span>
          ),
        },
        {
          accessorKey: "date",
          header: "Date",
          cell: ({ row }) =>
            new Date(row.original.date).toLocaleString("en-US", {
              dateStyle: "medium",
              timeStyle: "short",
            }),
        },
        {
          accessorKey: "customerName",
          header: "Customer",
        },
        {
          id: "itemCount",
          header: "Items",
          cell: ({ row }) => row.original.lines.length,
        },
        {
          accessorKey: "total",
          header: "Total",
          cell: ({ row }) => (
            <span className="font-medium">${row.original.total.toFixed(2)}</span>
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
        {
          id: "actions",
          header: "",
          cell: ({ row }) => {
            const order = row.original
            const isRefundable = order.status === "Completed" || order.status === "Pending"
            return (
              <div className="flex items-center gap-2 justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDetailOrder(order)
                    setDetailOpen(true)
                  }}
                >
                  <Eye className="h-4 w-4 mr-1" />
                  View Details
                </Button>
                {canRefund && isRefundable && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleRefund(order.id)}
                  >
                    <RotateCcw className="h-4 w-4 mr-1" />
                    Refund
                  </Button>
                )}
              </div>
            )
          },
        },
      ]
      return cols
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canRefund]
  )

  return (
    <div className="flex flex-col gap-6">
      {/* ── Header ── */}
      <PageHeader
        title="Sales / POS"
        description="Process orders and view sales history"
      />

      {/* ── Tabs ── */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="history">Order History</TabsTrigger>
          <TabsTrigger value="new-order">New Order</TabsTrigger>
        </TabsList>

        {/* ── Order History Tab — [PROV-FR-SALE-01] ── */}
        <TabsContent value="history">
          <div className="bg-card border rounded-md p-4">
            <DataTable
              columns={columns}
              data={pagedOrders}
              pageIndex={pageIndex}
              pageSize={PAGE_SIZE}
              pageCount={pageCount}
              onPageChange={setPageIndex}
            />
          </div>
        </TabsContent>

        {/* ── New Order Tab — [PROV-FR-SALE-02] ── */}
        <TabsContent value="new-order">
          <NewOrderForm onOrderPlaced={handleOrderPlaced} />
        </TabsContent>
      </Tabs>

      {/* ── Order Detail Dialog ── */}
      <OrderDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        order={detailOrder}
      />
    </div>
  )
}
