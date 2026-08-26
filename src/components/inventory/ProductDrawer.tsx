"use client"

import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { productSchema, ProductValues } from "@/lib/validation/inventory"
import { CURRENCY_SYMBOL } from "@/lib/format/currency"

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
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"

interface ProductDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  product?: ProductValues // undefined means "Create", defined means "Edit"
  onSave?: (data: ProductValues) => void
}

export function ProductDrawer({ open, onOpenChange, product, onSave }: ProductDrawerProps) {
  const isEdit = !!product

  const form = useForm<ProductValues>({
    // as any: known zodResolver + z.coerce interop gap, not a real type error
    // z.coerce.number() has input=unknown / output=number; @hookform/resolvers can't reconcile that yet
    resolver: zodResolver(productSchema) as any,
    defaultValues: product || {
      name: "",
      sku: "",
      category: "",
      price: 0,
      cost: 0,
      uom: "piece",
      reorderPoint: 10,
      initialStock: 0,
    },
  })

  // Reset form when opened with a new product
  React.useEffect(() => {
    if (open) {
      if (product) {
        form.reset(product)
      } else {
        form.reset({
          name: "",
          sku: "",
          category: "",
          price: 0,
          cost: 0,
          uom: "piece",
          reorderPoint: 10,
          initialStock: 0,
        })
      }
    }
  }, [open, product, form])

  const onSubmit = (data: ProductValues) => {
    console.log(isEdit ? "Update Product:" : "Create Product:", data)
    onSave?.(data)
    onOpenChange(false)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md overflow-y-auto">
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
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <SheetFooter className="mt-8 pt-4 border-t">
              <SheetClose render={<Button type="button" variant="outline">Cancel</Button>} />
              <Button type="submit">
                {isEdit ? "Save Changes" : "Create Product"}
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  )
}
