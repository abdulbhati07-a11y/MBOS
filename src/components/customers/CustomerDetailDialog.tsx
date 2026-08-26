"use client"

// ---------------------------------------------------------------------------
// src/components/customers/CustomerDetailDialog.tsx
//
// Reads `GET /customers/:id`, which resolves DEBT-004. The previous version
// paired orders to customers by comparing **name strings**, so two customers
// called "J. Smith" saw each other's purchases and renaming a customer detached
// their whole history. The endpoint queries the real `Order.customerId` FK.
//
// What this deliberately does **not** show: a lifetime-spend figure. The history
// arrives paginated, so summing the rows on screen gives the total for *this page*
// — a number that would silently be wrong for any customer with more orders than
// fit, and wrong in the direction of understating what a customer is worth. The
// order count is safe because it comes from `pagination.total`, which the server
// computes over the whole set. A real lifetime-spend needs a server-side aggregate
// (and a decision about whether Pending and Refunded orders count); until that
// exists, showing nothing beats showing a figure nobody can reconcile.
//
// Money here is minor units — `formatMoneyMinor`, not `formatMoney`.
// ---------------------------------------------------------------------------

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { ShoppingBag } from "lucide-react"

import { formatMoneyMinor } from "@/lib/format/currency"
import { StatusBadge } from "@/components/shared/StatusBadge"
import { EmptyState } from "@/components/shared/EmptyState"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import {
  customerKeys,
  fetchCustomer,
  type Customer,
} from "@/lib/api/customers/queries"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const CUSTOMER_STATUS_VARIANTS: Record<string, "success" | "secondary"> = {
  Active: "success",
  Inactive: "secondary",
}

/**
 * Keyed by the status strings the API sends. `Record<string, …>` rather than a
 * union-keyed map because `Order.status` widens to `string` on the customer's
 * order summary, and a status the map does not know should fall through to the
 * badge's default rather than fail to compile.
 */
const ORDER_STATUS_VARIANTS: Record<string, "success" | "warning" | "destructive"> = {
  Completed: "success",
  Pending: "warning",
  Refunded: "destructive",
}

/** How many history rows the dialog shows. Beyond this, see the Sales page. */
const HISTORY_PAGE_SIZE = 10

interface CustomerDetailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  customer: Customer | null
}

export function CustomerDetailDialog({
  open,
  onOpenChange,
  customer,
}: CustomerDetailDialogProps) {
  const customerId = customer?.id

  const detail = useQuery({
    queryKey: customerKeys.detail(customerId ?? "", {
      pageSize: HISTORY_PAGE_SIZE,
    }),
    queryFn: ({ signal }) =>
      fetchCustomer(customerId as string, { pageSize: HISTORY_PAGE_SIZE }, signal),
    // Only fetch when the dialog is actually showing someone. `enabled` rather
    // than an early return, because hooks cannot be called conditionally and the
    // dialog stays mounted between openings.
    enabled: open && customerId !== undefined,
  })

  if (customer === null) return null

  // The list row is already in hand, so identity fields render immediately and
  // only the history waits on the request. Falling back to the row also keeps the
  // dialog readable if the detail fetch fails outright.
  const record = detail.data ?? customer
  const orders = detail.data?.orders.data ?? []
  const totalOrders = detail.data?.orders.pagination.total

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{record.name}</DialogTitle>
          <DialogDescription>
            {record.email}
            {record.phone ? ` · ${record.phone}` : ""}
          </DialogDescription>
        </DialogHeader>

        {/* Identity fields */}
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-20 shrink-0">Status</span>
            <StatusBadge
              status={record.isActive ? "Active" : "Inactive"}
              variantMap={CUSTOMER_STATUS_VARIANTS}
            />
          </div>
          {record.address && (
            <div className="flex items-start gap-2">
              <span className="text-muted-foreground w-20 shrink-0">Address</span>
              <span>{record.address}</span>
            </div>
          )}
          {record.notes && (
            <div className="flex items-start gap-2">
              <span className="text-muted-foreground w-20 shrink-0">Notes</span>
              <span>{record.notes}</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-20 shrink-0">Orders</span>
            <span>
              {totalOrders === undefined
                ? "—"
                : `${totalOrders} order${totalOrders === 1 ? "" : "s"}`}
            </span>
          </div>
        </div>

        {/* Order history */}
        <div>
          <h3 className="text-sm font-medium mb-2">Order History</h3>

          {detail.isPending ? (
            <div className="space-y-2" aria-busy="true">
              <span className="sr-only">Loading order history…</span>
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : detail.isError ? (
            <div className="space-y-3 rounded-md border p-4">
              <p role="alert" className="text-sm text-destructive">
                Could not load this customer&apos;s order history.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void detail.refetch()}
              >
                Try again
              </Button>
            </div>
          ) : orders.length === 0 ? (
            <EmptyState
              icon={ShoppingBag}
              title="No orders yet"
              description="This customer has no orders on record."
              className="border rounded-md shadow-none min-h-[120px]"
            />
          ) : (
            <>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order #</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map((order) => (
                      <TableRow key={order.id}>
                        <TableCell className="font-mono font-medium">
                          {order.orderNumber}
                        </TableCell>
                        <TableCell>
                          {new Date(order.date).toLocaleDateString("en-US", {
                            dateStyle: "medium",
                          })}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatMoneyMinor(order.totalCents)}
                        </TableCell>
                        <TableCell>
                          <StatusBadge
                            status={order.status}
                            variantMap={ORDER_STATUS_VARIANTS}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {totalOrders !== undefined && totalOrders > orders.length && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Showing the {orders.length} most recent of {totalOrders} orders.
                </p>
              )}
            </>
          )}
        </div>

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  )
}
