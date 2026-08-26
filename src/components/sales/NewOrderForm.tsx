"use client"

import * as React from "react"
import { useForm, useFieldArray } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { newOrderSchema, NewOrderValues } from "@/lib/validation/sales"
import { useProducts } from "@/contexts/products-context"
import { OrderRecord, OrderLineRecord, PaymentMethod } from "@/lib/mock-data/orders"
import { formatMoney } from "@/lib/format/currency"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { AlertTriangle, Plus, Trash2 } from "lucide-react"

interface NewOrderFormProps {
  onOrderPlaced: (order: OrderRecord) => void
}

export function NewOrderForm({ onOrderPlaced }: NewOrderFormProps) {
  const products = useProducts()
  const [selectedProductId, setSelectedProductId] = React.useState<string>("")

  const form = useForm<NewOrderValues>({
    // as any: known zodResolver + z.coerce interop gap with Zod v4
    resolver: zodResolver(newOrderSchema) as any,
    defaultValues: {
      customerName: "",
      paymentMethod: "Cash",
      taxRate: 0,
      lines: [],
    },
  })

  const { fields, append, remove, update } = useFieldArray({
    control: form.control,
    name: "lines",
  })

  const watchedLines = form.watch("lines")
  const watchedTaxRate = form.watch("taxRate")

  // ---------------------------------------------------------------------------
  // Derived totals — [PROV-FR-SALE-04]
  // These are rupees (major units) — what the cashier types and reads. Float
  // arithmetic is acceptable here because nothing is persisted from it: the
  // conversion to integer paisa happens once at the API boundary, via
  // parseMoneyToMinor. Every value below is rendered through formatMoney, which
  // fixes two decimals, so a 17% GST line on an odd subtotal displays exactly.
  // ---------------------------------------------------------------------------
  const subtotal = watchedLines.reduce((sum, line) => sum + (line.unitPrice * line.quantity || 0), 0)
  const taxAmount = subtotal * ((watchedTaxRate || 0) / 100)
  const grandTotal = subtotal + taxAmount

  // ---------------------------------------------------------------------------
  // Add a product as a new line item — [PROV-FR-SALE-02]
  // ---------------------------------------------------------------------------
  const handleAddProduct = () => {
    if (!selectedProductId) return
    const product = products.find((p) => p.id === selectedProductId)
    if (!product) return

    // If the product already exists in lines, just bump the quantity
    const existingIdx = fields.findIndex((f) => f.productId === product.id)
    if (existingIdx >= 0) {
      const existing = watchedLines[existingIdx]
      const newQty = existing.quantity + 1
      update(existingIdx, {
        ...existing,
        quantity: newQty,
        lineTotal: existing.unitPrice * newQty,
      })
    } else {
      append({
        productId: product.id,
        productName: product.name,
        unitPrice: product.price,
        quantity: 1,
        lineTotal: product.price,
      })
    }
    setSelectedProductId("")
  }

  // ---------------------------------------------------------------------------
  // Quantity change — update lineTotal in real time — [PROV-FR-SALE-03]
  // ---------------------------------------------------------------------------
  const handleQuantityChange = (index: number, rawValue: string) => {
    const qty = Math.max(1, parseInt(rawValue, 10) || 1)
    const line = watchedLines[index]
    update(index, {
      ...line,
      quantity: qty,
      lineTotal: line.unitPrice * qty,
    })
  }

  // ---------------------------------------------------------------------------
  // Place order — [PROV-FR-SALE-02]
  // ---------------------------------------------------------------------------
  const onSubmit = (data: NewOrderValues) => {
    const sub = data.lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0)
    const tax = sub * ((data.taxRate || 0) / 100)

    const newOrder: OrderRecord = {
      id: `ord-${Date.now()}`,
      orderNumber: `#${Math.floor(1000 + Math.random() * 9000)}`,
      date: new Date().toISOString(),
      customerName: data.customerName?.trim() || "Walk-in",
      // customerId is null for POS-created orders until Sales↔Customers
      // linking is built in the backend integration phase. (DEBT-004)
      customerId: null,
      paymentMethod: data.paymentMethod as PaymentMethod,
      status: "Pending",
      taxRate: data.taxRate || 0,
      subtotal: sub,
      taxAmount: tax,
      total: sub + tax,
      lines: data.lines.map<OrderLineRecord>((l) => ({
        productId: l.productId,
        productName: l.productName,
        unitPrice: l.unitPrice,
        quantity: l.quantity,
        lineTotal: l.unitPrice * l.quantity,
      })),
    }

    onOrderPlaced(newOrder)
    form.reset({ customerName: "", paymentMethod: "Cash", taxRate: 0, lines: [] })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-6">

        {/* ── Product Picker ── */}
        <div className="rounded-md border bg-card p-4 space-y-3">
          <h3 className="font-medium text-sm">Add Products</h3>
          <div className="flex items-center gap-2">
            <Select value={selectedProductId} onValueChange={(v) => setSelectedProductId(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Search and select a product…" />
              </SelectTrigger>
              <SelectContent>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} — {formatMoney(p.price)}
                    {p.stock === 0 && " (Out of stock)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              onClick={handleAddProduct}
              disabled={!selectedProductId}
            >
              <Plus className="h-4 w-4 mr-1" />
              Add
            </Button>
          </div>
        </div>

        {/* ── Line Items Table — [PROV-FR-SALE-03] ── */}
        <div className="rounded-md border bg-card">
          {fields.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No items added yet. Select a product above to begin.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Unit Price</TableHead>
                  <TableHead className="text-right w-28">Qty</TableHead>
                  <TableHead className="text-right">Line Total</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {fields.map((field, index) => {
                  const line = watchedLines[index]
                  const product = products.find((p) => p.id === field.productId)
                  // [PROV-BR-07]: warn if quantity exceeds current live stock.
                  // Stock is read from shared ProductsContext — reflects any
                  // adjustments made in Inventory during the same session.
                  const isOverStock = product !== undefined && (line?.quantity ?? 0) > product.stock

                  return (
                    <TableRow key={field.id}>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-sm">{field.productName}</span>
                          {isOverStock && (
                            <span
                              className="flex items-center gap-0.5 text-xs text-warning font-medium"
                              title={`Only ${product?.stock} in stock`}
                            >
                              <AlertTriangle className="h-3.5 w-3.5" />
                              Low stock ({product?.stock} left)
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {formatMoney(field.unitPrice)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          min={1}
                          value={line?.quantity ?? 1}
                          onChange={(e) => handleQuantityChange(index, e.target.value)}
                          className="w-20 ml-auto text-right"
                        />
                      </TableCell>
                      <TableCell className="text-right text-sm font-medium">
                        {formatMoney((line?.unitPrice ?? 0) * (line?.quantity ?? 1))}
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => remove(index)}
                          className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                          <span className="sr-only">Remove item</span>
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Zod error for empty lines array */}
        <FormField
          control={form.control}
          name="lines"
          render={() => (
            <FormItem className="hidden">
              <FormMessage />
            </FormItem>
          )}
        />
        {form.formState.errors.lines?.root && (
          <p className="text-sm text-destructive -mt-4">
            {form.formState.errors.lines.root.message}
          </p>
        )}
        {(form.formState.errors.lines as any)?.message && (
          <p className="text-sm text-destructive -mt-4">
            {(form.formState.errors.lines as any).message}
          </p>
        )}

        {/* ── Order Summary + Customer + Payment — [PROV-FR-SALE-04] ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Left: customer & payment */}
          <div className="space-y-4">
            <FormField
              control={form.control}
              name="customerName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Customer Name <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                  <FormControl>
                    <Input placeholder="Walk-in" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="paymentMethod"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Payment Method</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select payment method" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="Cash">Cash</SelectItem>
                      <SelectItem value="Card">Card</SelectItem>
                      <SelectItem value="Mobile">Mobile</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="taxRate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tax Rate (%)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step={0.1}
                      placeholder="0"
                      {...field}
                      onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {/* Right: order totals */}
          <div className="rounded-md bg-muted p-4 text-sm space-y-2 self-start">
            <h3 className="font-medium mb-3">Order Summary</h3>
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal</span>
              <span>{formatMoney(subtotal)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              {/* taxRate is a percentage, not money — .toFixed(1) is correct here */}
              <span>Tax ({(watchedTaxRate || 0).toFixed(1)}%)</span>
              <span>{formatMoney(taxAmount)}</span>
            </div>
            <div className="flex justify-between font-semibold text-base border-t pt-2 mt-2">
              <span>Grand Total</span>
              <span>{formatMoney(grandTotal)}</span>
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <Button type="submit" size="lg">
            Place Order
          </Button>
        </div>
      </form>
    </Form>
  )
}
