"use client"

// ---------------------------------------------------------------------------
// src/components/sales/OrderDetailDialog.tsx
//
// `GET /orders/:id`, which is the only view that carries the lines and refunds —
// the list endpoint returns neither.
//
// It takes an `orderId` rather than an `Order`, so the dialog re-reads rather than
// rendering a row the list fetched some time ago. That matters here more than on
// most detail views: a refund taken from this dialog changes the order, and a
// dialog rendering a stale prop would show the old figures until the list caught up.
// ---------------------------------------------------------------------------

import * as React from "react"
import { useQuery } from "@tanstack/react-query"

import {
  fetchOrder,
  isFullyRefunded,
  orderKeys,
  refundableCents,
} from "@/lib/api/sales/queries"
import { formatMoneyMinor } from "@/lib/format/currency"
import { formatTaxRateBps } from "@/lib/api/settings/queries"
import { StatusBadge } from "@/components/shared/StatusBadge"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
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

// Status variant map — consistent with the Order History table
const ORDER_STATUS_VARIANTS = {
  Completed: "success",
  Pending: "warning",
  Refunded: "destructive",
} as const satisfies Record<string, "success" | "warning" | "destructive">

interface OrderDetailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  orderId: string | null
  /**
   * Shown when the viewer holds `sales.refund` and the order still has value left
   * to reverse. Omitted entirely otherwise — the page owns that decision, because
   * it is the page that knows the viewer's permissions.
   */
  onRefund?: (orderId: string) => void
}

export function OrderDetailDialog({
  open,
  onOpenChange,
  orderId,
  onRefund,
}: OrderDetailDialogProps) {
  const orderQuery = useQuery({
    queryKey: orderKeys.detail(orderId ?? ""),
    queryFn: ({ signal }) => fetchOrder(orderId as string, signal),
    // Both guards matter: no id means nothing to read, and a closed dialog should
    // not hold a subscription that refetches in the background.
    enabled: orderId !== null && open,
  })

  const order = orderQuery.data ?? null

  const formattedDate =
    order === null
      ? ""
      : new Date(order.date).toLocaleString("en-US", {
          dateStyle: "medium",
          timeStyle: "short",
        })

  const refundable = order === null ? 0 : refundableCents(order)
  const fullyRefunded = order !== null && isFullyRefunded(order)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {order === null ? "Order" : `Order ${order.orderNumber}`}
          </DialogTitle>
          <DialogDescription>
            {order === null
              ? "Loading the order…"
              : `${formattedDate} — ${order.customerName ?? "Walk-in"} • ${order.paymentMethod}`}
          </DialogDescription>
        </DialogHeader>

        {orderQuery.isPending ? (
          <div className="space-y-3">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : orderQuery.isError || order === null ? (
          <div className="space-y-3">
            <p role="alert" className="text-sm text-destructive">
              Could not load this order.
            </p>
            <Button variant="outline" size="sm" onClick={() => orderQuery.refetch()}>
              Try again
            </Button>
          </div>
        ) : (
          <>
            {/* Status */}
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Status:</span>
              <StatusBadge status={order.status} variantMap={ORDER_STATUS_VARIANTS} />
              {/* `status: "Refunded"` means *at least one* refund exists, so the
                  status alone cannot distinguish a partial reversal from a full
                  one. This says which. */}
              {order.status === "Refunded" && (
                <span className="text-xs text-muted-foreground">
                  {fullyRefunded
                    ? "fully refunded"
                    : `partially refunded — ${formatMoneyMinor(refundable)} still outstanding`}
                </span>
              )}
            </div>

            {/* Line Items */}
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Unit Price</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Line Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {order.lines.map((line) => (
                    <TableRow key={line.id}>
                      {/* The name as it read at sale time (BR-10), not a live
                          lookup — a renamed product does not rewrite receipts. */}
                      <TableCell className="font-medium">{line.productName}</TableCell>
                      <TableCell className="text-right">
                        {formatMoneyMinor(line.unitPriceCents)}
                      </TableCell>
                      <TableCell className="text-right">{line.quantity}</TableCell>
                      <TableCell className="text-right">
                        {formatMoneyMinor(line.lineTotalCents)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Order Summary */}
            <div className="rounded-md bg-muted p-3 text-sm space-y-1.5">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span>{formatMoneyMinor(order.subtotalCents)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                {/* The rate frozen onto this order (BR-03), not the tenant's
                    current setting — an order taxed at 15% keeps saying 15%
                    after the business moves to 18%. */}
                <span>Tax ({formatTaxRateBps(order.taxRateBps)})</span>
                <span>{formatMoneyMinor(order.taxAmountCents)}</span>
              </div>
              <div className="flex justify-between font-semibold border-t pt-1.5 mt-1.5">
                <span>Grand Total</span>
                <span>{formatMoneyMinor(order.totalCents)}</span>
              </div>
              {order.refundedCents > 0 && (
                <>
                  <div className="flex justify-between text-destructive">
                    <span>Refunded</span>
                    <span>-{formatMoneyMinor(order.refundedCents)}</span>
                  </div>
                  <div className="flex justify-between border-t pt-1.5 font-semibold">
                    <span>Net</span>
                    <span>
                      {formatMoneyMinor(order.totalCents - order.refundedCents)}
                    </span>
                  </div>
                </>
              )}
            </div>

            {/* Refunds — the reversal trail (BR-03). Each refund is its own
                record rather than an edit to the order, so the history shows
                what was returned, when, and why. */}
            {order.refunds.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium">Refunds</h4>
                <ul className="divide-y rounded-md border text-sm">
                  {order.refunds.map((refund) => (
                    <li
                      key={refund.id}
                      className="flex items-start justify-between gap-3 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="font-medium">
                          {formatMoneyMinor(refund.amountCents)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(refund.createdAt).toLocaleString("en-US", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </p>
                      </div>
                      <p className="max-w-[60%] text-right text-xs text-muted-foreground">
                        {refund.reason === "" ? "No reason given" : refund.reason}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        <DialogFooter showCloseButton>
          {/* Only offered on a completed order with value left: a Pending order has
              taken no money and no stock, so there is nothing to reverse — it is
              cancelled, not refunded. */}
          {onRefund !== undefined &&
            order !== null &&
            order.status !== "Pending" &&
            refundable > 0 && (
              <Button variant="outline" onClick={() => onRefund(order.id)}>
                Refund…
              </Button>
            )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
