"use client"

// ---------------------------------------------------------------------------
// src/app/(dashboard)/sales/page.tsx
//
// `GET /orders`, paginated and filtered server-side.
//
// Two things changed shape when this page moved onto the API:
//
// **Complete is now an action.** Orders are created `Pending`; completing one is
// what decrements stock (FR-SALE-04). The mock version had no such step — orders
// simply appeared finished — so the page had no button for the single most
// consequential thing a till does. Its 409 (insufficient stock at any line) is the
// real over-sell check, which is why the new-order form treats its own stock
// warning as advisory.
//
// **Refund is a transaction, not a status flip.** The mock implementation mapped
// the row's status to "Refunded" locally and left a TODO about inventory. The API
// records a `Refund` row against the order with an amount and a reason, allows
// several of them, and answers 409 when they would exceed the total. So the amount
// has to be asked for, which is why there is now a dialog rather than a button that
// silently does something.
//
// A consequence worth stating: `status: "Refunded"` means *at least one* refund
// exists, not that the order is fully reversed. Nothing on this page may read the
// status as "fully refunded" — only `refundedCents` against `totalCents` says that,
// and only the detail endpoint carries it.
// ---------------------------------------------------------------------------

import * as React from "react"
import { ColumnDef } from "@tanstack/react-table"
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { Check, Eye, RotateCcw } from "lucide-react"

import { PageHeader } from "@/components/shared/PageHeader"
import { DataTable } from "@/components/shared/DataTable"
import { StatusBadge } from "@/components/shared/StatusBadge"
import { useBreadcrumb } from "@/contexts/breadcrumb-context"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useCanPerform } from "@/contexts/role-context"
import { Modules, Actions } from "@/config/permissions"
import { formatMoneyMinor } from "@/lib/format/currency"
import { isApiError } from "@/lib/api/client"

import { OrderDetailDialog } from "@/components/sales/OrderDetailDialog"
import { RefundDialog } from "@/components/sales/RefundDialog"
import { NewOrderForm } from "@/components/sales/NewOrderForm"
import {
  fetchOrder,
  fetchOrders,
  orderKeys,
  refundableCents,
  ORDER_STATUSES,
  type Order,
  type OrderDetail,
  type OrderListParams,
  type OrderStatus,
} from "@/lib/api/sales/queries"
import { completeOrder } from "@/lib/api/sales/mutations"
import { customerKeys } from "@/lib/api/customers/queries"
import { inventoryKeys, productKeys } from "@/lib/api/inventory/queries"

const SALES_CRUMBS = [{ label: "Sales" }] as const

const ORDER_STATUS_VARIANTS: Record<OrderStatus, "success" | "warning" | "destructive"> = {
  Completed: "success",
  Pending: "warning",
  Refunded: "destructive",
}

const PAGE_SIZE = 10

/** The status filter's "no filter" option. `""` is not a valid `OrderStatus`. */
const ALL_STATUSES = "all"

export default function SalesPage() {
  useBreadcrumb("Sales", SALES_CRUMBS as unknown as { label: string; href?: string }[])

  const queryClient = useQueryClient()
  const canWrite = useCanPerform(Modules.SALES, Actions.WRITE)
  const canRefund = useCanPerform(Modules.SALES, Actions.REFUND)

  // --- Query state ---------------------------------------------------------
  const [pageIndex, setPageIndex] = React.useState(0)
  const [statusFilter, setStatusFilter] = React.useState<OrderStatus | typeof ALL_STATUSES>(
    ALL_STATUSES,
  )

  const params = React.useMemo<OrderListParams>(
    () => ({
      pageIndex,
      pageSize: PAGE_SIZE,
      ...(statusFilter === ALL_STATUSES ? {} : { status: statusFilter }),
    }),
    [pageIndex, statusFilter],
  )

  const ordersQuery = useQuery({
    queryKey: orderKeys.list(params),
    queryFn: ({ signal }) => fetchOrders(params, signal),
    placeholderData: keepPreviousData,
  })

  const orders = ordersQuery.data?.data ?? []
  const pageCount = ordersQuery.data?.pagination.pageCount ?? 0
  const total = ordersQuery.data?.pagination.total

  /**
   * Every change that can shrink the result set goes through here, and resets to
   * the first page.
   *
   * The alternative — letting the filter change and correcting an out-of-range
   * `pageIndex` afterwards in an effect — renders the empty page first and fixes it
   * on a second pass, which both flashes an empty table and spends a request on a
   * page that does not exist. Resetting at the cause means the out-of-range state
   * never occurs, so there is nothing to correct.
   *
   * Growing `pageIndex` is safe without a clamp: `DataTable` derives Next from
   * `pageCount` and disables it on the last page.
   */
  const applyFilter = (next: OrderStatus | typeof ALL_STATUSES) => {
    setStatusFilter(next)
    setPageIndex(0)
  }

  // --- Dialog state -------------------------------------------------------
  const [activeTab, setActiveTab] = React.useState<string>("history")
  const [detailOrderId, setDetailOrderId] = React.useState<string | null>(null)
  const [detailOpen, setDetailOpen] = React.useState(false)

  const [refundOrderDetail, setRefundOrderDetail] = React.useState<OrderDetail | null>(null)
  const [refundOpen, setRefundOpen] = React.useState(false)
  const [rowError, setRowError] = React.useState<string | null>(null)

  /**
   * Everything a completion or a refund moves.
   *
   * Products and the inventory ledger are in here because completing an order
   * decrements stock — a sales action that silently changes what the inventory page
   * shows. Customers are in here because an attributed order appears in that
   * customer's history.
   */
  const invalidateAfterSale = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: orderKeys.all })
    void queryClient.invalidateQueries({ queryKey: productKeys.all })
    void queryClient.invalidateQueries({ queryKey: inventoryKeys.all })
    void queryClient.invalidateQueries({ queryKey: customerKeys.all })
  }, [queryClient])

  // --- Complete (FR-SALE-04) ----------------------------------------------
  const complete = useMutation({
    mutationFn: (orderId: string) => completeOrder(orderId),
    onSuccess: () => {
      setRowError(null)
      invalidateAfterSale()
    },
    onError: (err) => {
      if (!isApiError(err)) {
        setRowError("Could not reach the server. The order was not completed.")
        return
      }
      if (err.isConflict) {
        // Two distinct 409s land here: stock ran out between placing and
        // completing, or the order is not Pending any more because someone else
        // completed it. The server's message distinguishes them; paraphrasing it
        // would lose which one happened.
        setRowError(err.message)
        return
      }
      if (err.isForbidden) {
        setRowError("You do not have permission to complete orders.")
        return
      }
      setRowError(err.message)
    },
  })

  // --- Refund -------------------------------------------------------------

  /**
   * Reads the order's detail before opening the refund dialog.
   *
   * The list row cannot answer "how much is left to refund" — `refundedCents` is
   * detail-only. Fetching first means the dialog opens with a real remaining
   * balance rather than assuming the full total is available.
   */
  const openRefund = async (orderId: string) => {
    setRowError(null)
    try {
      const order = await queryClient.fetchQuery({
        queryKey: orderKeys.detail(orderId),
        queryFn: ({ signal }) => fetchOrder(orderId, signal),
      })
      setRefundOrderDetail(order)
      setRefundOpen(true)
    } catch (err) {
      setRowError(
        isApiError(err) ? err.message : "Could not load the order to refund it.",
      )
    }
  }

  const handleOrderPlaced = (order: OrderDetail) => {
    invalidateAfterSale()
    setPageIndex(0)
    setStatusFilter(ALL_STATUSES)
    setActiveTab("history")
    // Straight into the order that was just placed, because the next thing the
    // operator does is complete it.
    setDetailOrderId(order.id)
    setDetailOpen(true)
  }

  // --- Columns ------------------------------------------------------------
  const columns = React.useMemo<ColumnDef<Order>[]>(() => {
    const cols: ColumnDef<Order>[] = [
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
        cell: ({ row }) =>
          row.original.customerName ?? (
            <span className="text-muted-foreground">Walk-in</span>
          ),
      },
      {
        // Distinct lines, not units sold — `2` is two products.
        accessorKey: "lineCount",
        header: "Items",
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
          const isCompleting =
            complete.isPending && complete.variables === order.id

          return (
            <div className="flex items-center gap-2 justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDetailOrderId(order.id)
                  setDetailOpen(true)
                }}
              >
                <Eye className="h-4 w-4 mr-1" />
                View Details
              </Button>

              {/* Only a Pending order can be completed — that transition is the
                  one that takes the stock. */}
              {canWrite && order.status === "Pending" && (
                <Button
                  variant="default"
                  size="sm"
                  disabled={complete.isPending}
                  onClick={() => complete.mutate(order.id)}
                >
                  <Check className="h-4 w-4 mr-1" />
                  {isCompleting ? "Completing…" : "Complete"}
                </Button>
              )}

              {/* A Pending order has taken neither money nor stock, so there is
                  nothing to reverse. Refunding it would credit a sale that never
                  happened. */}
              {canRefund && order.status !== "Pending" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void openRefund(order.id)}
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canWrite, canRefund, complete.isPending, complete.variables])

  return (
    <div className="flex flex-col gap-6">
      {/* ── Header ── */}
      <PageHeader
        title="Sales / POS"
        description={
          total === undefined
            ? "Process orders and view sales history"
            : `${total} order${total === 1 ? "" : "s"} on record`
        }
      />

      {/* ── Tabs ── */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="history">Order History</TabsTrigger>
          {canWrite && <TabsTrigger value="new-order">New Order</TabsTrigger>}
        </TabsList>

        {/* ── Order History Tab — [PROV-FR-SALE-01] ── */}
        <TabsContent value="history" className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <Select
              value={statusFilter}
              onValueChange={(value) =>
                applyFilter(value as OrderStatus | typeof ALL_STATUSES)
              }
            >
              <SelectTrigger className="w-48" aria-label="Filter by status">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_STATUSES}>All statuses</SelectItem>
                {ORDER_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {rowError !== null && (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {rowError}
            </p>
          )}

          <div className="bg-card border rounded-md p-4">
            {ordersQuery.isError ? (
              <div className="space-y-3 py-8 text-center">
                <p role="alert" className="text-sm text-destructive">
                  {isApiError(ordersQuery.error) && ordersQuery.error.isForbidden
                    ? "You do not have permission to view sales history."
                    : "Could not load orders."}
                </p>
                <Button variant="outline" onClick={() => void ordersQuery.refetch()}>
                  Try again
                </Button>
              </div>
            ) : (
              <DataTable
                columns={columns}
                data={orders}
                isLoading={ordersQuery.isPending}
                pageIndex={pageIndex}
                pageSize={PAGE_SIZE}
                pageCount={pageCount}
                onPageChange={setPageIndex}
              />
            )}
          </div>
        </TabsContent>

        {/* ── New Order Tab — [PROV-FR-SALE-02] ── */}
        {canWrite && (
          <TabsContent value="new-order">
            <NewOrderForm onOrderPlaced={handleOrderPlaced} />
          </TabsContent>
        )}
      </Tabs>

      {/* ── Order Detail Dialog ── */}
      <OrderDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        orderId={detailOrderId}
        onRefund={
          canRefund
            ? (orderId) => {
                setDetailOpen(false)
                void openRefund(orderId)
              }
            : undefined
        }
      />

      {/* ── Refund Dialog ── */}
      <RefundDialog
        open={refundOpen}
        onOpenChange={setRefundOpen}
        order={refundOrderDetail}
        refundableCents={
          refundOrderDetail === null ? 0 : refundableCents(refundOrderDetail)
        }
      />
    </div>
  )
}
