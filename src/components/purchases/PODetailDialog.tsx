"use client"

// ---------------------------------------------------------------------------
// src/components/purchases/PODetailDialog.tsx
//
// Read-only PO detail. The list endpoint returns no line items — only a
// `lineCount` — so opening a PO fetches `GET /purchase-orders/:id` for its lines
// and status history rather than reading them off the row.
//
// Every money field is minor units (paisa): `formatMoneyMinor`, never
// `formatMoney`.
// ---------------------------------------------------------------------------

import * as React from "react"
import { useQuery } from "@tanstack/react-query"

import {
  purchaseOrderKeys,
  fetchPurchaseOrder,
  type POStatus,
} from "@/lib/api/purchases/queries"
import { formatMoneyMinor } from "@/lib/format/currency"
import { StatusBadge } from "@/components/shared/StatusBadge"
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

const PO_STATUS_VARIANTS: Record<POStatus, "secondary" | "warning" | "success" | "destructive"> = {
  Draft: "secondary",
  Sent: "warning",
  Received: "success",
  Cancelled: "destructive",
}

interface PODetailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** `null` when nothing is selected — the query stays disabled until a row opens it. */
  poId: string | null
}

export function PODetailDialog({ open, onOpenChange, poId }: PODetailDialogProps) {
  const detailQuery = useQuery({
    queryKey: poId ? purchaseOrderKeys.detail(poId) : ["purchase-orders", "detail", "none"],
    queryFn: ({ signal }) => fetchPurchaseOrder(poId as string, signal),
    enabled: open && poId !== null,
  })

  const po = detailQuery.data

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{po?.poNumber ?? "Purchase Order"}</DialogTitle>
          <DialogDescription>
            {po
              ? `${new Date(po.date).toLocaleString("en-US", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })} — ${po.supplierName}`
              : "Loading order details…"}
          </DialogDescription>
        </DialogHeader>

        {detailQuery.isError ? (
          <div className="space-y-3 py-6 text-center">
            <p role="alert" className="text-sm text-destructive">
              Could not load this purchase order.
            </p>
            <Button variant="outline" onClick={() => void detailQuery.refetch()}>
              Try again
            </Button>
          </div>
        ) : detailQuery.isPending || !po ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Loading…
          </div>
        ) : (
          <>
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
                  {po.lines.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell className="font-medium">{line.productName}</TableCell>
                      <TableCell className="text-right">
                        {formatMoneyMinor(line.unitCostCents)}
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

            {/* Order summary — a PO carries no tax, so total equals subtotal. */}
            <div className="rounded-md bg-muted p-3 text-sm space-y-1.5">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span>{formatMoneyMinor(po.subtotalCents)}</span>
              </div>
              <div className="flex justify-between font-semibold border-t pt-1.5 mt-1.5">
                <span>Total</span>
                <span>{formatMoneyMinor(po.totalCents)}</span>
              </div>
            </div>

            {/* Status history — the append-only audit trail, newest last. */}
            {po.statusTransitions.length > 0 && (
              <div className="text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground">History</p>
                {po.statusTransitions.map((t) => (
                  <div key={t.id} className="flex justify-between">
                    <span>
                      {t.fromStatus} → {t.toStatus}
                    </span>
                    <span>
                      {new Date(t.changedAt).toLocaleDateString("en-US", {
                        dateStyle: "medium",
                      })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  )
}
