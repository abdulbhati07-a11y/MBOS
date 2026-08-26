"use client"

import * as React from "react"
import { CustomerRecord } from "@/lib/mock-data/customers"
import { OrderStatus } from "@/lib/mock-data/orders"
import { useOrders } from "@/contexts/orders-context"
import { formatMoney } from "@/lib/format/currency"
import { StatusBadge } from "@/components/shared/StatusBadge"
import { EmptyState } from "@/components/shared/EmptyState"
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
import { ShoppingBag } from "lucide-react"

const CUSTOMER_STATUS_VARIANTS: Record<string, "success" | "secondary"> = {
  Active: "success",
  Inactive: "secondary",
}

const ORDER_STATUS_VARIANTS: Record<OrderStatus, "success" | "warning" | "destructive"> = {
  Completed: "success",
  Pending: "warning",
  Refunded: "destructive",
}

interface CustomerDetailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  customer: CustomerRecord | null
}

export function CustomerDetailDialog({
  open,
  onOpenChange,
  customer,
}: CustomerDetailDialogProps) {
  // Hook called unconditionally — rules of hooks
  const allOrders = useOrders()

  if (!customer) return null

  // Filter by customerId (FK) — structurally correct and collision-safe.
  // Orders with customerId: null (unlinked POS orders) are correctly excluded.
  // Single filter: both table rows and summary totals derive from this one
  // array so they are structurally guaranteed to agree.
  // Reads from live OrdersContext — reflects session-placed orders.
  const orders = allOrders.filter((o) => o.customerId === customer.id)
  const totalOrders = orders.length
  const totalSpend = orders.reduce((sum, o) => sum + o.total, 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{customer.name}</DialogTitle>
          <DialogDescription>
            {customer.email}
            {customer.phone ? ` · ${customer.phone}` : ""}
          </DialogDescription>
        </DialogHeader>

        {/* Identity fields */}
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-20 shrink-0">Status</span>
            <StatusBadge
              status={customer.isActive ? "Active" : "Inactive"}
              variantMap={CUSTOMER_STATUS_VARIANTS}
            />
          </div>
          {customer.address && (
            <div className="flex items-start gap-2">
              <span className="text-muted-foreground w-20 shrink-0">Address</span>
              <span>{customer.address}</span>
            </div>
          )}
          {customer.notes && (
            <div className="flex items-start gap-2">
              <span className="text-muted-foreground w-20 shrink-0">Notes</span>
              <span>{customer.notes}</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-20 shrink-0">Orders</span>
            <span>
              {totalOrders} order{totalOrders !== 1 ? "s" : ""} ·{" "}
              {formatMoney(totalSpend)} total spend
            </span>
          </div>
        </div>

        {/* Order history */}
        <div>
          <h3 className="text-sm font-medium mb-2">Order History</h3>
          {orders.length === 0 ? (
            <EmptyState
              icon={ShoppingBag}
              title="No orders yet"
              description="This customer has no orders on record."
              className="border rounded-md shadow-none min-h-[120px]"
            />
          ) : (
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
                        {formatMoney(order.total)}
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
          )}
        </div>

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  )
}
