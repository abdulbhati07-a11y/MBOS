"use client"

import * as React from "react"
import { OrderRecord } from "@/lib/mock-data/orders"
import { StatusBadge } from "@/components/shared/StatusBadge"
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
  order: OrderRecord | null
}

export function OrderDetailDialog({ open, onOpenChange, order }: OrderDetailDialogProps) {
  if (!order) return null

  const formattedDate = new Date(order.date).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Order {order.orderNumber}</DialogTitle>
          <DialogDescription>
            {formattedDate} — {order.customerName} &bull; {order.paymentMethod}
          </DialogDescription>
        </DialogHeader>

        {/* Status */}
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Status:</span>
          <StatusBadge status={order.status} variantMap={ORDER_STATUS_VARIANTS} />
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
              {order.lines.map((line, idx) => (
                <TableRow key={`${line.productId}-${idx}`}>
                  <TableCell className="font-medium">{line.productName}</TableCell>
                  <TableCell className="text-right">${line.unitPrice.toFixed(2)}</TableCell>
                  <TableCell className="text-right">{line.quantity}</TableCell>
                  <TableCell className="text-right">${line.lineTotal.toFixed(2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Order Summary */}
        <div className="rounded-md bg-muted p-3 text-sm space-y-1.5">
          <div className="flex justify-between text-muted-foreground">
            <span>Subtotal</span>
            <span>${order.subtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>Tax ({order.taxRate}%)</span>
            <span>${order.taxAmount.toFixed(2)}</span>
          </div>
          <div className="flex justify-between font-semibold border-t pt-1.5 mt-1.5">
            <span>Grand Total</span>
            <span>${order.total.toFixed(2)}</span>
          </div>
        </div>

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  )
}
