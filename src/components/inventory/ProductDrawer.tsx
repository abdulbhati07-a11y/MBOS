"use client"

// ---------------------------------------------------------------------------
// src/components/inventory/ProductDrawer.tsx
//
// Create/edit form, now submitting to `POST /products` and `PATCH /products/:id`.
//
// Two things about this form are contract, not preference:
//
//   - **Rupees in, paisa out.** The fields hold major units because that is what
//     a price tag says; the conversion to integer minor units happens at the page's
//     mutation boundary. A 422 therefore names `priceCents` while the user is
//     looking at a field labelled "Price", so the error mapping below re-homes it.
//   - **Initial stock only exists on create, and 0 is the right answer.** A
//     non-zero opening balance writes no ledger row, so the stock history starts
//     mid-story with no reason code explaining where the goods came from. Receiving
//     stock through Adjust Stock leaves that row. The field stays because a fresh
//     catalogue import is a real case, but the hint says what it costs.
//
// `stock` is absent from edit mode entirely — `PATCH /products/:id` refuses it
// with a 422 rather than silently dropping it, because a form that appears to move
// stock without leaving a ledger row would break the single-writer rule the
// inventory count depends on (BR-02).
// ---------------------------------------------------------------------------

import * as React from "react"
import { useForm, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { productSchema, ProductValues } from "@/lib/validation/inventory"
import { CURRENCY_SYMBOL } from "@/lib/format/currency"
import { isApiError } from "@/lib/api/client"

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetFooter,
  SheetClose,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"

interface ProductDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  product?: ProductValues // undefined means "Create", defined means "Edit"
  /**
   * Resolves when the write has landed, rejects with the ApiError if it has not.
   * The drawer stays open on rejection so a long form is not lost to a 409.
   */
  onSave: (data: ProductValues) => Promise<unknown>
}

const EMPTY: ProductValues = {
  name: "",
  sku: "",
  category: "",
  price: 0,
  cost: 0,
  uom: "piece",
  reorderPoint: 10,
  initialStock: 0,
}

/**
 * Server field name → form field name.
 *
 * Only the money fields differ, and they differ because the wire is in minor
 * units. Without this map a 422 on `priceCents` would attach to nothing and the
 * form would look like it failed for no reason.
 */
const SERVER_FIELD_TO_FORM: Record<string, keyof ProductValues> = {
  name: "name",
  sku: "sku",
  category: "category",
  priceCents: "price",
  costCents: "cost",
  uom: "uom",
  reorderPoint: "reorderPoint",
  initialStock: "initialStock",
}

/**
 * The form body, mounted only while the drawer is open.
 *
 * `SheetContent` renders through Base UI's portal, whose `keepMounted` defaults to
 * `false`, so these children unmount on close and remount on open — which is what
 * makes `defaultValues` sufficient. A `form.reset()` in an effect keyed on `open`
 * would do the same thing a render later, showing the previously edited product's
 * values in the newly opened drawer until the effect corrected them.
 */
function ProductForm({
  product,
  onSave,
  onDone,
}: {
  product?: ProductValues
  onSave: (data: ProductValues) => Promise<unknown>
  onDone: () => void
}) {
  const isEdit = !!product
  const [formError, setFormError] = React.useState<string | null>(null)

  const form = useForm<ProductValues>({
    // Asserted, not assigned: `z.coerce.number()` types its input as `unknown`, so
    // the schema's input type is not `ProductValues`. `Resolver<ProductValues>`
    // narrows the assertion to one shape rather than using `any`, which would
    // switch off checking for everything downstream.
    resolver: zodResolver(productSchema) as unknown as Resolver<ProductValues>,
    defaultValues: product ?? EMPTY,
  })

  const onSubmit = async (data: ProductValues) => {
    setFormError(null)
    try {
      await onSave(data)
      onDone()
    } catch (err) {
      if (!isApiError(err)) {
        setFormError("Could not reach the server. Nothing was saved.")
        return
      }
      if (err.isConflict) {
        // The only unique constraint on a product is `(tenantId, sku)`, so a 409
        // here is always the SKU — including one held by a soft-deleted product,
        // which still occupies the code.
        form.setError("sku", {
          type: "server",
          message: "That SKU is already in use.",
        })
        return
      }
      if (err.isValidation) {
        for (const [field, message] of Object.entries(err.fieldErrors())) {
          const formField = SERVER_FIELD_TO_FORM[field]
          if (formField !== undefined) {
            form.setError(formField, { type: "server", message })
          }
        }
        return
      }
      if (err.isForbidden) {
        setFormError("You do not have permission to save products.")
        return
      }
      setFormError(err.message)
    }
  }

  const saving = form.formState.isSubmitting

  return (
    <>
      <SheetHeader className="mb-6">
          <SheetTitle>{isEdit ? "Edit Product" : "Add Product"}</SheetTitle>
          <SheetDescription>
            {isEdit
              ? "Make changes to the product profile here."
              : "Enter the details for the new product."}
          </SheetDescription>
        </SheetHeader>

        <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Product Name</FormLabel>
                <FormControl>
                  <Input placeholder="e.g. Wireless Mouse" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="sku"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>SKU</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. WM-001" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Category</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Electronics" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="price"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Price ({CURRENCY_SYMBOL})</FormLabel>
                  <FormControl>
                    <Input type="number" step="0.01" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="cost"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Cost ({CURRENCY_SYMBOL})</FormLabel>
                  <FormControl>
                    <Input type="number" step="0.01" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="uom"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Unit of Measure</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. piece" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="reorderPoint"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reorder Point</FormLabel>
                  <FormControl>
                    <Input type="number" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {!isEdit && (
            <FormField
              control={form.control}
              name="initialStock"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Initial Stock Quantity</FormLabel>
                  <FormControl>
                    <Input type="number" {...field} />
                  </FormControl>
                  <FormDescription>
                    Leave at 0 and receive stock through Adjust Stock — that
                    records who received it and why. An opening balance entered
                    here has no such entry.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          {formError !== null && (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {formError}
            </p>
          )}

          <SheetFooter className="mt-8 pt-4 border-t">
            <SheetClose
              render={
                <Button type="button" variant="outline" disabled={saving}>
                  Cancel
                </Button>
              }
            />
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : isEdit ? "Save Changes" : "Create Product"}
            </Button>
          </SheetFooter>
        </form>
      </Form>
    </>
  )
}

export function ProductDrawer({ open, onOpenChange, product, onSave }: ProductDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md overflow-y-auto">
        <ProductForm
          product={product}
          onSave={onSave}
          onDone={() => onOpenChange(false)}
        />
      </SheetContent>
    </Sheet>
  )
}
