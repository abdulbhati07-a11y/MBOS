"use client"

import * as React from "react"
import { useForm, useFieldArray, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { newPOSchema, NewPOValues } from "@/lib/validation/purchases"
import { MOCK_PRODUCTS } from "@/lib/mock-data/products"
import { MOCK_SUPPLIERS } from "@/lib/mock-data/suppliers"
import { PurchaseOrderRecord, POLineRecord } from "@/lib/mock-data/purchase-orders"
import { formatMoney, CURRENCY_SYMBOL } from "@/lib/format/currency"

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
import { Plus, Trash2 } from "lucide-react"

interface NewPOFormProps {
  onPOCreated: (po: PurchaseOrderRecord) => void
}

export function NewPOForm({ onPOCreated }: NewPOFormProps) {
  const [selectedProductId, setSelectedProductId] = React.useState<string>("")

  const form = useForm<NewPOValues>({
    // Asserted, not assigned: `z.coerce.number()` types its input as `unknown`, so
    // the schema's input type is not `NewPOValues`. `Resolver<NewPOValues>` narrows
    // the assertion to one shape rather than using `any`.
    resolver: zodResolver(newPOSchema) as unknown as Resolver<NewPOValues>,
    defaultValues: {
      supplierName: "",
      notes: "",
      lines: [],
    },
  })

  const { fields, append, remove, update } = useFieldArray({
    control: form.control,
    name: "lines",
  })

  const watchedLines = form.watch("lines")

  // Derived grand total. The form's money fields are rupees (major units) —
  // what the buyer types — so this sum is float arithmetic on rupees, fine for
  // a display total. The conversion to integer paisa happens once, at the API
  // boundary, via parseMoneyToMinor. All display goes through formatMoney.
  const grandTotal = watchedLines.reduce(
    (sum, line) => sum + (line.unitCost * line.quantity || 0),
    0
  )

  // ---------------------------------------------------------------------------
  // Add product as line item — pre-fills unitCost from product.cost.
  // Buyer can override unitCost after adding. [PROV-FR-PUR-04]
  // ---------------------------------------------------------------------------
  const handleAddProduct = () => {
    if (!selectedProductId) return
    const product = MOCK_PRODUCTS.find((p) => p.id === selectedProductId)
    if (!product) return

    const existingIdx = fields.findIndex((f) => f.productId === product.id)
    if (existingIdx >= 0) {
      const existing = watchedLines[existingIdx]
      const newQty = existing.quantity + 1
      update(existingIdx, {
        ...existing,
        quantity: newQty,
        lineTotal: existing.unitCost * newQty,
      })
    } else {
      append({
        productId: product.id,
        productName: product.name,
        unitCost: product.cost, // pre-filled from product.cost; buyer may override
        quantity: 1,
        lineTotal: product.cost,
      })
    }
    setSelectedProductId("")
  }

  // ---------------------------------------------------------------------------
  // Quantity change — recomputes lineTotal in real time [PROV-FR-PUR-04]
  // ---------------------------------------------------------------------------
  const handleQuantityChange = (index: number, rawValue: string) => {
    const qty = Math.max(1, parseInt(rawValue, 10) || 1)
    const line = watchedLines[index]
    update(index, {
      ...line,
      quantity: qty,
      lineTotal: line.unitCost * qty,
    })
  }

  // ---------------------------------------------------------------------------
  // Unit cost change — recomputes lineTotal in real time [PROV-FR-PUR-04]
  // ---------------------------------------------------------------------------
  const handleUnitCostChange = (index: number, rawValue: string) => {
    const cost = Math.max(0, parseFloat(rawValue) || 0)
    const line = watchedLines[index]
    update(index, {
      ...line,
      unitCost: cost,
      lineTotal: cost * line.quantity,
    })
  }

  // ---------------------------------------------------------------------------
  // Submit [PROV-FR-PUR-04]
  // ---------------------------------------------------------------------------
  const onSubmit = (data: NewPOValues) => {
    const subtotal = data.lines.reduce((s, l) => s + l.unitCost * l.quantity, 0)

    const newPO: PurchaseOrderRecord = {
      id: `po-${Date.now()}`,
      poNumber: `PO-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`,
      date: new Date().toISOString(),
      supplierName: data.supplierName,
      status: "Draft",
      subtotal,
      total: subtotal,
      notes: data.notes ?? "",
      lines: data.lines.map<POLineRecord>((l) => ({
        productId: l.productId,
        productName: l.productName,
        unitCost: l.unitCost,
        quantity: l.quantity,
        lineTotal: l.unitCost * l.quantity,
      })),
    }

    onPOCreated(newPO)
    form.reset({ supplierName: "", notes: "", lines: [] })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-6">

        {/* ── Supplier select ── */}
        <div className="rounded-md border bg-card p-4 space-y-3">
          <h3 className="font-medium text-sm">Supplier</h3>
          <FormField
            control={form.control}
            name="supplierName"
            render={({ field }) => (
              <FormItem>
                <Select value={field.value} onValueChange={(v) => field.onChange(v ?? "")}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select a supplier…" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {MOCK_SUPPLIERS.filter((s) => s.isActive).map((s) => (
                      <SelectItem key={s.id} value={s.name}>
                        {s.name}
                        {s.categories ? ` — ${s.categories}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* ── Product picker ── */}
        <div className="rounded-md border bg-card p-4 space-y-3">
          <h3 className="font-medium text-sm">Add Products</h3>
          <div className="flex items-center gap-2">
            <Select
              value={selectedProductId}
              onValueChange={(v) => setSelectedProductId(v ?? "")}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a product to add…" />
              </SelectTrigger>
              <SelectContent>
                {MOCK_PRODUCTS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} — cost {formatMoney(p.cost)}
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

        {/* ── Line items table ── */}
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
                  <TableHead className="text-right w-32">
                    Unit Cost ({CURRENCY_SYMBOL})
                  </TableHead>
                  <TableHead className="text-right w-28">Qty</TableHead>
                  <TableHead className="text-right">Line Total</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {fields.map((field, index) => {
                  const line = watchedLines[index]
                  return (
                    <TableRow key={field.id}>
                      <TableCell className="font-medium text-sm">
                        {field.productName}
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          min={0}
                          step={0.01}
                          value={line?.unitCost ?? 0}
                          onChange={(e) => handleUnitCostChange(index, e.target.value)}
                          className="w-28 ml-auto text-right"
                        />
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
                        {formatMoney((line?.unitCost ?? 0) * (line?.quantity ?? 1))}
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

        {/* Zod error for empty lines. Both spellings are checked because RHF puts
            an array-level message on `.root` in current versions and on `.message`
            in older ones; whichever is populated, the operator sees it. */}
        {form.formState.errors.lines?.message !== undefined && (
          <p className="text-sm text-destructive">
            {form.formState.errors.lines.message}
          </p>
        )}
        {form.formState.errors.lines?.root && (
          <p className="text-sm text-destructive">
            {form.formState.errors.lines.root.message}
          </p>
        )}

        {/* ── Summary + notes ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <FormField
            control={form.control}
            name="notes"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Notes{" "}
                  <span className="text-muted-foreground font-normal">(optional)</span>
                </FormLabel>
                <FormControl>
                  <Input placeholder="Delivery instructions, reference numbers, etc." {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="rounded-md bg-muted p-4 text-sm space-y-2 self-start">
            <h3 className="font-medium mb-3">Order Summary</h3>
            <div className="flex justify-between font-semibold text-base">
              <span>Grand Total</span>
              <span>{formatMoney(grandTotal)}</span>
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <Button type="submit" size="lg">
            Create Purchase Order
          </Button>
        </div>
      </form>
    </Form>
  )
}
