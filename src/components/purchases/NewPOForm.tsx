"use client"

// ---------------------------------------------------------------------------
// src/components/purchases/NewPOForm.tsx
//
// Draft-a-PO form, submitting to `POST /purchase-orders`.
//
// The form works in **rupees** (major units) because that is what a buyer types
// and reads; the conversion to integer paisa happens once, at submit, via
// `parseMoneyToMinor`. The supplier and product pickers are now the live lists —
// only active suppliers can be chosen, and the product's stored `costCents`
// pre-fills a line's unit cost as an editable default.
// ---------------------------------------------------------------------------

import * as React from "react"
import { useForm, useFieldArray, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { newPOSchema, NewPOValues } from "@/lib/validation/purchases"
import { fetchProducts, productKeys } from "@/lib/api/inventory/queries"
import { fetchSuppliers, supplierKeys } from "@/lib/api/suppliers/queries"
import {
  createPurchaseOrder,
  type CreatePOLineInput,
} from "@/lib/api/purchases/mutations"
import { purchaseOrderKeys } from "@/lib/api/purchases/queries"
import { isApiError } from "@/lib/api/client"
import {
  formatMoney,
  formatMoneyMinor,
  parseMoneyToMinor,
  CURRENCY_SYMBOL,
} from "@/lib/format/currency"

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

/** A high fixed page — the picker lists options rather than paginating. */
const PICKER_PAGE_SIZE = 100

interface NewPOFormProps {
  /** Called after a PO is created so the page can switch to the list tab. */
  onCreated: () => void
}

export function NewPOForm({ onCreated }: NewPOFormProps) {
  const queryClient = useQueryClient()
  const [selectedProductId, setSelectedProductId] = React.useState<string>("")
  const [formError, setFormError] = React.useState<string | null>(null)

  const suppliersQuery = useQuery({
    queryKey: supplierKeys.list({ isActive: true, pageSize: PICKER_PAGE_SIZE }),
    queryFn: ({ signal }) =>
      fetchSuppliers({ isActive: true, pageSize: PICKER_PAGE_SIZE }, signal),
  })
  const suppliers = suppliersQuery.data?.data ?? []

  const productsQuery = useQuery({
    queryKey: productKeys.list({ isActive: true, pageSize: PICKER_PAGE_SIZE }),
    queryFn: ({ signal }) =>
      fetchProducts({ isActive: true, pageSize: PICKER_PAGE_SIZE }, signal),
  })
  const products = productsQuery.data?.data ?? []

  const form = useForm<NewPOValues>({
    // Asserted, not assigned: `z` optional/default fields make the schema's input
    // type differ from `NewPOValues`. `Resolver<NewPOValues>` narrows the
    // assertion to one shape rather than using `any`.
    resolver: zodResolver(newPOSchema) as unknown as Resolver<NewPOValues>,
    defaultValues: {
      supplierId: "",
      notes: "",
      lines: [],
    },
  })

  const { fields, append, remove, update } = useFieldArray({
    control: form.control,
    name: "lines",
  })

  const watchedLines = form.watch("lines")

  // Derived grand total, in rupees — float arithmetic is fine for a display
  // figure; the exact conversion to paisa happens per line at submit.
  const grandTotal = watchedLines.reduce(
    (sum, line) => sum + (line.unitCost * line.quantity || 0),
    0
  )

  const create = useMutation({
    mutationFn: createPurchaseOrder,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: purchaseOrderKeys.all })
      form.reset({ supplierId: "", notes: "", lines: [] })
      onCreated()
    },
  })

  // ---------------------------------------------------------------------------
  // Add product as line item — pre-fills unitCost from the product's stored cost
  // (paisa → rupees for the form). Buyer can override afterwards. [PROV-FR-PUR-04]
  // ---------------------------------------------------------------------------
  const handleAddProduct = () => {
    if (!selectedProductId) return
    const product = products.find((p) => p.id === selectedProductId)
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
      const unitCost = product.costCents / 100
      append({
        productId: product.id,
        productName: product.name,
        unitCost,
        quantity: 1,
        lineTotal: unitCost,
      })
    }
    setSelectedProductId("")
  }

  const handleQuantityChange = (index: number, rawValue: string) => {
    const qty = Math.max(1, parseInt(rawValue, 10) || 1)
    const line = watchedLines[index]
    update(index, { ...line, quantity: qty, lineTotal: line.unitCost * qty })
  }

  const handleUnitCostChange = (index: number, rawValue: string) => {
    const cost = Math.max(0, parseFloat(rawValue) || 0)
    const line = watchedLines[index]
    update(index, { ...line, unitCost: cost, lineTotal: cost * line.quantity })
  }

  // ---------------------------------------------------------------------------
  // Submit — map the rupee-denominated form lines onto the API's paisa shape,
  // dropping the display-only fields (productName, lineTotal) that would trip
  // `forbidNonWhitelisted`. [PROV-FR-PUR-04]
  // ---------------------------------------------------------------------------
  const onSubmit = async (data: NewPOValues) => {
    setFormError(null)

    const lines: CreatePOLineInput[] = []
    for (const line of data.lines) {
      const unitCostCents = parseMoneyToMinor(line.unitCost)
      if (unitCostCents === null) {
        setFormError(
          `“${line.productName}” has an invalid unit cost. Use at most two decimal places.`
        )
        return
      }
      lines.push({ productId: line.productId, unitCostCents, quantity: line.quantity })
    }

    try {
      await create.mutateAsync({
        supplierId: data.supplierId,
        notes: data.notes ? data.notes : undefined,
        lines,
      })
    } catch (err) {
      if (!isApiError(err)) {
        setFormError("Could not reach the server. The order was not created.")
        return
      }
      if (err.isForbidden) {
        setFormError("You do not have permission to create purchase orders.")
        return
      }
      // 422s here are line-level (e.g. an unknown productId) and do not map onto a
      // single form field; the server message is the most useful thing to show.
      setFormError(err.message)
    }
  }

  const dataError = suppliersQuery.isError || productsQuery.isError
  const submitting = create.isPending || form.formState.isSubmitting

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-6">
        {dataError && (
          <p
            role="alert"
            className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            Could not load suppliers or products. Reload the page to try again.
          </p>
        )}

        {/* ── Supplier select ── */}
        <div className="rounded-md border bg-card p-4 space-y-3">
          <h3 className="font-medium text-sm">Supplier</h3>
          <FormField
            control={form.control}
            name="supplierId"
            render={({ field }) => (
              <FormItem>
                <Select value={field.value} onValueChange={(v) => field.onChange(v ?? "")}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select a supplier…" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
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
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} — cost {formatMoneyMinor(p.costCents)}
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

        {formError !== null && (
          <p
            role="alert"
            className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {formError}
          </p>
        )}

        <div className="flex justify-end">
          <Button type="submit" size="lg" disabled={submitting || dataError}>
            {submitting ? "Creating…" : "Create Purchase Order"}
          </Button>
        </div>
      </form>
    </Form>
  )
}
