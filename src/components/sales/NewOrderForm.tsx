"use client"

// ---------------------------------------------------------------------------
// src/components/sales/NewOrderForm.tsx
//
// The POS cart, submitting to `POST /orders`.
//
// What the server owns and this form therefore does not:
//
//   - **Unit prices.** Snapshotted from `Product.priceCents` at creation. The
//     prices shown here are for the running total only; if the catalogue changes
//     between opening the tab and placing the order, the order takes the new price
//     and the response comes back with the real figures.
//   - **Totals.** Computed from the lines and the tax rate (BR-05). Everything in
//     the summary panel is a preview that the response supersedes.
//   - **The tax rate.** The tenant's configured `defaultTaxRateBps` applies. It is
//     shown, not edited: the rate is a business setting (FR-SET-02) and BR-03
//     freezes whatever it produced onto the order.
//
// Both pickers search the server rather than filtering a preloaded list, because
// a real catalogue is longer than a `<Select>` and a customer list is longer
// still. Stock is read from the same search results, so the over-stock warning
// reflects the catalogue at the moment of the search — the authoritative check is
// the 409 that `PATCH /orders/:id/status` answers when completion cannot move the
// goods (PROV-BR-07).
// ---------------------------------------------------------------------------

import * as React from "react"
import { useForm, useFieldArray, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { AlertTriangle, Plus, Search, Trash2, X } from "lucide-react"

import { newOrderSchema, NewOrderValues } from "@/lib/validation/sales"
import { formatMoneyMinor } from "@/lib/format/currency"
import { isApiError } from "@/lib/api/client"
import { useOperatingBranch } from "@/contexts/session-context"
import {
  fetchSettings,
  formatTaxRateBps,
  settingsKeys,
  BPS_PER_UNIT,
} from "@/lib/api/settings/queries"
import {
  fetchProducts,
  productKeys,
  type Product,
} from "@/lib/api/inventory/queries"
import {
  fetchCustomers,
  customerKeys,
  type Customer,
} from "@/lib/api/customers/queries"
import type { OrderDetail } from "@/lib/api/sales/queries"
import { PAYMENT_METHODS } from "@/lib/api/sales/queries"
import { createOrder } from "@/lib/api/sales/mutations"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Form,
  FormControl,
  FormDescription,
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

const SEARCH_DEBOUNCE_MS = 300
/** Enough to pick from without turning the picker into a second product table. */
const SEARCH_RESULT_LIMIT = 8

const EMPTY_ORDER: NewOrderValues = {
  customerId: null,
  paymentMethod: "Cash",
  lines: [],
}

interface NewOrderFormProps {
  /** Receives the created order, which carries the server's real totals. */
  onOrderPlaced: (order: OrderDetail) => void
}

/** Debounces a value by `SEARCH_DEBOUNCE_MS`, so typing is not a request per key. */
function useDebounced(value: string): string {
  const [debounced, setDebounced] = React.useState(value)
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [value])
  return debounced
}

export function NewOrderForm({ onOrderPlaced }: NewOrderFormProps) {
  const branch = useOperatingBranch()
  const [formError, setFormError] = React.useState<string | null>(null)

  const form = useForm<NewOrderValues>({
    // Asserted rather than assigned: `z.coerce.number()` on the line quantity types
    // its input as `unknown`, so the schema's input type is not `NewOrderValues`.
    // Going through `Resolver<NewOrderValues>` keeps the assertion to one shape
    // instead of `any`, which would switch off checking downstream of it.
    resolver: zodResolver(newOrderSchema) as unknown as Resolver<NewOrderValues>,
    defaultValues: EMPTY_ORDER,
  })

  const { fields, append, remove, update } = useFieldArray({
    control: form.control,
    name: "lines",
  })

  const watchedLines = form.watch("lines")

  // --- Tax rate, read from settings ---------------------------------------
  // `settings.read` is an Owner/Manager permission, so a Cashier's fetch 403s.
  // That is not an error worth showing: the rate applies server-side either way,
  // and the preview simply omits the tax line. Hence no error branch below.
  const settingsQuery = useQuery({
    queryKey: settingsKeys.tenant(),
    queryFn: ({ signal }) => fetchSettings(signal),
    retry: false,
  })
  const taxRateBps = settingsQuery.data?.defaultTaxRateBps ?? null

  // --- Product search -----------------------------------------------------
  const [productSearch, setProductSearch] = React.useState("")
  const debouncedProductSearch = useDebounced(productSearch)

  const productsQuery = useQuery({
    queryKey: productKeys.list({
      search: debouncedProductSearch,
      pageSize: SEARCH_RESULT_LIMIT,
      isActive: true,
    }),
    queryFn: ({ signal }) =>
      fetchProducts(
        {
          pageSize: SEARCH_RESULT_LIMIT,
          isActive: true,
          ...(debouncedProductSearch === ""
            ? {}
            : { search: debouncedProductSearch }),
        },
        signal,
      ),
    placeholderData: keepPreviousData,
  })

  // --- Customer search ----------------------------------------------------
  const [customerSearch, setCustomerSearch] = React.useState("")
  const debouncedCustomerSearch = useDebounced(customerSearch)

  const customersQuery = useQuery({
    queryKey: customerKeys.list({
      search: debouncedCustomerSearch,
      pageSize: SEARCH_RESULT_LIMIT,
      isActive: true,
    }),
    queryFn: ({ signal }) =>
      fetchCustomers(
        {
          pageSize: SEARCH_RESULT_LIMIT,
          isActive: true,
          ...(debouncedCustomerSearch === ""
            ? {}
            : { search: debouncedCustomerSearch }),
        },
        signal,
      ),
    placeholderData: keepPreviousData,
    // A Cashier holds customers.read, so unlike settings this is a real failure
    // if it errors — but it is never fatal to the sale: walk-in still works.
  })

  /**
   * The chosen customer's record, held locally.
   *
   * Kept in state rather than looked up in `customersQuery` because the search
   * results move as the operator types, and the name in the header must not
   * disappear when the query that produced it is replaced.
   */
  const [chosenCustomer, setChosenCustomer] = React.useState<Customer | null>(null)

  const chooseCustomer = (customer: Customer) => {
    setChosenCustomer(customer)
    form.setValue("customerId", customer.id)
    setCustomerSearch("")
  }

  const clearCustomer = () => {
    setChosenCustomer(null)
    form.setValue("customerId", null)
  }

  // --- Cart ---------------------------------------------------------------

  /**
   * Live stock by product id, from whatever the picker has most recently seen.
   *
   * A line added ten minutes ago keeps its warning state from that moment. Rather
   * than re-reading each product on a timer, the form treats the warning as
   * advisory and lets completion be the check that counts.
   */
  const stockByProduct = React.useMemo(() => {
    const map = new Map<string, number>()
    for (const product of productsQuery.data?.data ?? []) {
      map.set(product.id, product.stock)
    }
    return map
  }, [productsQuery.data])

  const addProduct = (product: Product) => {
    setFormError(null)
    const existingIndex = fields.findIndex((f) => f.productId === product.id)
    if (existingIndex >= 0) {
      const existing = watchedLines[existingIndex]
      update(existingIndex, { ...existing, quantity: existing.quantity + 1 })
      return
    }
    append({
      productId: product.id,
      productName: product.name,
      unitPriceCents: product.priceCents,
      quantity: 1,
    })
  }

  const changeQuantity = (index: number, raw: string) => {
    const parsed = Number.parseInt(raw, 10)
    const quantity = Number.isNaN(parsed) ? 1 : Math.max(1, parsed)
    update(index, { ...watchedLines[index], quantity })
  }

  // --- Preview totals -----------------------------------------------------
  // All in minor units, so the arithmetic is integer and matches the server's for
  // the subtotal exactly. The tax line can differ by a paisa — the server rounds
  // half-up on the whole subtotal — which is why the response's figures replace
  // these rather than being compared against them.
  const subtotalCents = watchedLines.reduce(
    (sum, line) => sum + line.unitPriceCents * line.quantity,
    0,
  )
  const taxAmountCents =
    taxRateBps === null
      ? null
      : Math.round((subtotalCents * taxRateBps) / BPS_PER_UNIT)
  const totalCents = subtotalCents + (taxAmountCents ?? 0)

  // --- Submit -------------------------------------------------------------
  const onSubmit = async (data: NewOrderValues) => {
    setFormError(null)

    if (branch === null) {
      setFormError(
        "No active branch is configured for this business, so an order cannot be filed. Add a branch under Settings.",
      )
      return
    }

    try {
      const order = await createOrder({
        customerId: data.customerId,
        branchId: branch.id,
        paymentMethod: data.paymentMethod,
        // No taxRateBps: the tenant default applies. Sending the rate read from
        // settings would freeze a stale copy of it onto the order.
        lines: data.lines.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
        })),
      })

      onOrderPlaced(order)
      form.reset(EMPTY_ORDER)
      setChosenCustomer(null)
      setProductSearch("")
    } catch (err) {
      if (!isApiError(err)) {
        setFormError("Could not reach the server. No order was placed.")
        return
      }
      if (err.isValidation) {
        // The 422s that reach here name a product that is no longer on sale, an
        // unknown id, or a total above the int4 ceiling. None maps to a field the
        // operator can fix in place, so the server's own message is the useful one.
        setFormError(err.message)
        return
      }
      if (err.isForbidden) {
        setFormError("You do not have permission to place orders.")
        return
      }
      setFormError(err.message)
    }
  }

  const placing = form.formState.isSubmitting
  const products = productsQuery.data?.data ?? []
  const customers = customersQuery.data?.data ?? []

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-6">
        {branch === null && (
          <p
            role="alert"
            className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            No active branch is configured for this business. Orders cannot be
            placed until one exists — add a branch under Settings.
          </p>
        )}

        {/* ── Product picker ── */}
        <div className="rounded-md border bg-card p-4 space-y-3">
          <h3 className="font-medium text-sm">Add Products</h3>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={productSearch}
              onChange={(event) => setProductSearch(event.target.value)}
              placeholder="Search the catalogue by name or SKU…"
              aria-label="Search products"
              className="pl-9"
            />
          </div>

          {productsQuery.isPending ? (
            <div className="space-y-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : productsQuery.isError ? (
            <p role="alert" className="text-sm text-destructive">
              Could not load the catalogue.
            </p>
          ) : products.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {debouncedProductSearch === ""
                ? "No active products in the catalogue."
                : `Nothing matches “${debouncedProductSearch}”.`}
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {products.map((product) => (
                <li
                  key={product.id}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{product.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {product.sku} · {formatMoneyMinor(product.priceCents)} ·{" "}
                      {product.stock} {product.uom} in stock
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => addProduct(product)}
                    disabled={placing}
                  >
                    <Plus className="mr-1 h-4 w-4" />
                    Add
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ── Cart ── */}
        <div className="rounded-md border bg-card">
          {fields.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No items added yet. Search for a product above to begin.
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
                  const quantity = line?.quantity ?? 1
                  const stock = stockByProduct.get(field.productId)
                  const isOverStock = stock !== undefined && quantity > stock

                  return (
                    <TableRow key={field.id}>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium">
                            {field.productName}
                          </span>
                          {isOverStock && (
                            <span
                              className="flex items-center gap-0.5 text-xs font-medium text-warning"
                              title={`Only ${stock} in stock — completing this order will be refused`}
                            >
                              <AlertTriangle className="h-3.5 w-3.5" />
                              Only {stock} left
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {formatMoneyMinor(field.unitPriceCents)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          min={1}
                          value={quantity}
                          onChange={(event) =>
                            changeQuantity(index, event.target.value)
                          }
                          className="ml-auto w-20 text-right"
                          aria-label={`Quantity for ${field.productName}`}
                        />
                      </TableCell>
                      <TableCell className="text-right text-sm font-medium">
                        {formatMoneyMinor(field.unitPriceCents * quantity)}
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
                          <span className="sr-only">
                            Remove {field.productName}
                          </span>
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </div>

        {/* The empty-cart message from the schema has no field to attach to. */}
        {form.formState.errors.lines?.message !== undefined && (
          <p role="alert" className="-mt-4 text-sm text-destructive">
            {form.formState.errors.lines.message}
          </p>
        )}

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {/* ── Customer and payment ── */}
          <div className="space-y-4">
            <FormField
              control={form.control}
              name="customerId"
              render={() => (
                <FormItem>
                  <FormLabel>
                    Customer{" "}
                    <span className="font-normal text-muted-foreground">
                      (optional)
                    </span>
                  </FormLabel>

                  {chosenCustomer !== null ? (
                    <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {chosenCustomer.name}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {chosenCustomer.email}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={clearCustomer}
                        disabled={placing}
                      >
                        <X className="mr-1 h-4 w-4" />
                        Walk-in
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <FormControl>
                          <Input
                            value={customerSearch}
                            onChange={(event) =>
                              setCustomerSearch(event.target.value)
                            }
                            placeholder="Search by name or email…"
                            className="pl-9"
                          />
                        </FormControl>
                      </div>

                      {debouncedCustomerSearch !== "" &&
                        (customersQuery.isError ? (
                          <p role="alert" className="text-sm text-destructive">
                            Could not search customers. The sale can still be
                            recorded as walk-in.
                          </p>
                        ) : customers.length === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            No customer matches “{debouncedCustomerSearch}”.
                          </p>
                        ) : (
                          <ul className="divide-y rounded-md border">
                            {customers.map((customer) => (
                              <li key={customer.id}>
                                <button
                                  type="button"
                                  onClick={() => chooseCustomer(customer)}
                                  className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-muted"
                                >
                                  <span className="text-sm font-medium">
                                    {customer.name}
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                    {customer.email}
                                  </span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        ))}
                    </div>
                  )}

                  <FormDescription>
                    Leave blank for a walk-in sale. Attaching a customer is what
                    puts the order in their history.
                  </FormDescription>
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
                      {/* Mapped from the constant the schema validates against, so
                          the options and the accepted values cannot drift. */}
                      {PAYMENT_METHODS.map((method) => (
                        <SelectItem key={method} value={method}>
                          {method}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {/* ── Summary ── */}
          <div className="self-start rounded-md bg-muted p-4 text-sm">
            <h3 className="mb-3 font-medium">Order Summary</h3>
            <div className="space-y-2">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span>{formatMoneyMinor(subtotalCents)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>
                  Tax{taxRateBps === null ? "" : ` (${formatTaxRateBps(taxRateBps)})`}
                </span>
                <span>
                  {taxAmountCents === null
                    ? "applied on placing"
                    : formatMoneyMinor(taxAmountCents)}
                </span>
              </div>
              <div className="mt-2 flex justify-between border-t pt-2 text-base font-semibold">
                <span>Grand Total</span>
                <span>
                  {taxAmountCents === null ? "—" : formatMoneyMinor(totalCents)}
                </span>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              An estimate. The server computes the totals from the catalogue price
              at the moment the order is placed, and its figures are the ones
              recorded.
            </p>
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

        <div className="flex items-center justify-end gap-3">
          <p className="text-sm text-muted-foreground">
            The order is placed as <strong>Pending</strong>. Completing it is what
            takes the stock.
          </p>
          <Button
            type="submit"
            size="lg"
            disabled={placing || branch === null || fields.length === 0}
          >
            {placing ? "Placing…" : "Place Order"}
          </Button>
        </div>
      </form>
    </Form>
  )
}
