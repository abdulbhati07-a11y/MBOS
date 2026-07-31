"use client"

import * as React from "react"
import { PurchaseOrderRecord, POStatus } from "@/lib/mock-data/purchase-orders"
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

const PO_STATUS_VARIANTS: Record<POStatus, "secondary" | "warning" | "success" | "destructive"> = {
  Draft:     "secondary",
  Sent:      "warning",
  Received:  "success",
  Cancelled: "destructive",
}

interface PODetailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  po: PurchaseOrderRecord | null
}

export function PODetailDialog({ open, onOpenChange, po }: PODetailDialogProps) {
  if (!po) return null

  // supplierName is stored as a plain string on the PO record and rendered
  // as text here. It is NOT passed through a supplier select or filtered by
  // isActive — so deactivating a supplier after a PO is created does not
  // affect how that PO's supplier name displays. A future edit-PO feature
  // must preserve this behaviour: show the stored name regardless of the
  // supplier's current active status, or risk silently losing it.

  const formattedDate = new Date(po.date).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{po.poNumber}</DialogTitle>
          <DialogDescription>
            {formattedDate} — {po.supplierName}
          </DialogDescription>
        </DialogHeader>

        {/* Status + notes */}
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Status:</span>
          <StatusBadge status={po.status} variantMap={PO_STATUS_VARIANTS} />
        </div>
        {po.notes && (
          <p className="text-sm text-muted-foreground">{po.notes}</p>
        )}

        {/* Line items */}
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Unit Cost</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Line Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {po.lines.map((line, idx) => (
                <TableRow key={`${line.productId}-${idx}`}>
                  <TableCell className="font-medium">{line.productName}</TableCell>
                  <TableCell className="text-right">${line.unitCost.toFixed(2)}</TableCell>
                  <TableCell className="text-right">{line.quantity}</TableCell>
                  <TableCell className="text-right">${line.lineTotal.toFixed(2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Order summary */}
        <div className="rounded-md bg-muted p-3 text-sm space-y-1.5">
          <div className="flex justify-between text-muted-foreground">
            <span>Subtotal</span>
            <span>${po.subtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between font-semibold border-t pt-1.5 mt-1.5">
            <span>Total</span>
            <span>${po.total.toFixed(2)}</span>
          </div>
        </div>

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  )
}
