"use client"

import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { supplierSchema, SupplierValues } from "@/lib/validation/purchases"
import { SupplierRecord } from "@/lib/mock-data/suppliers"

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
import { Switch } from "@/components/ui/switch"

interface SupplierDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  // undefined = Create mode; defined = Edit mode
  supplier?: SupplierRecord
  // Full list for duplicate-email guard (self-excluded in edit mode)
  suppliers: SupplierRecord[]
  onSave: (values: SupplierValues, id?: string) => void
}

export function SupplierDrawer({
  open,
  onOpenChange,
  supplier,
  suppliers,
  onSave,
}: SupplierDrawerProps) {
  const isEdit = !!supplier

  const blankDefaults: SupplierValues = {
    name: "",
    contactPerson: "",
    email: "",
    phone: "",
    address: "",
    categories: "",
    notes: "",
    isActive: true,
  }

  const form = useForm<SupplierValues>({
    // as any: known zodResolver + Zod v4 interop gap (same pattern as inventory)
    resolver: zodResolver(supplierSchema) as any,
    defaultValues: supplier
      ? {
          name: supplier.name,
          contactPerson: supplier.contactPerson,
          email: supplier.email,
          phone: supplier.phone,
          address: supplier.address,
          categories: supplier.categories,
          notes: supplier.notes,
          isActive: supplier.isActive,
        }
      : blankDefaults,
  })

  React.useEffect(() => {
    if (open) {
      form.reset(
        supplier
          ? {
              name: supplier.name,
              contactPerson: supplier.contactPerson,
              email: supplier.email,
              phone: supplier.phone,
              address: supplier.address,
              categories: supplier.categories,
              notes: supplier.notes,
              isActive: supplier.isActive,
            }
          : blankDefaults
      )
    }
    // blankDefaults is stable (module-level const equivalent defined inside
    // component but doesn't change — exhaustive-deps lint suppressed below)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, supplier, form])

  const onSubmit = (data: SupplierValues) => {
    // [PROV-BR-CUST-01 pattern] Duplicate email guard — client-side only.
    // Self-excluded in edit mode so an unchanged email never fires false-positive.
    const others = suppliers.filter((s) => s.id !== supplier?.id)
    const emailTaken = others.some(
      (s) => s.email.toLowerCase() === data.email.toLowerCase()
    )
    if (emailTaken) {
      form.setError("email", {
        type: "manual",
        message: "A supplier with this email already exists",
      })
      return
    }

    onSave(data, supplier?.id)
    onOpenChange(false)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md overflow-y-auto">
        <SheetHeader className="mb-6">
          <SheetTitle>{isEdit ? "Edit Supplier" : "Add Supplier"}</SheetTitle>
          <SheetDescription>
            {isEdit
              ? "Update the supplier's details below."
              : "Enter the details for the new supplier."}
          </SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Company Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Acme Supplies Ltd." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="contactPerson"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Contact Person</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Jane Smith" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="e.g. jane@acme.example.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Phone{" "}
                      <span className="text-muted-foreground font-normal">(optional)</span>
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="+1 555-0100" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="categories"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Categories{" "}
                      <span className="text-muted-foreground font-normal">(optional)</span>
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Electronics, Accessories" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Address{" "}
                    <span className="text-muted-foreground font-normal">(optional)</span>
                  </FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. 100 Supply Road, Warehouse District" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

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
                    <Input placeholder="Payment terms, lead times, etc." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* isActive toggle — Edit mode only */}
            {isEdit && (
              <FormField
                control={form.control}
                name="isActive"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-md border p-3">
                    <div>
                      <FormLabel className="text-sm font-medium">Active</FormLabel>
                      <p className="text-xs text-muted-foreground">
                        Inactive suppliers remain in the list but are visually marked.
                      </p>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            )}

            <SheetFooter className="mt-8 pt-4 border-t">
              <SheetClose render={<Button type="button" variant="outline">Cancel</Button>} />
              <Button type="submit">
                {isEdit ? "Save Changes" : "Add Supplier"}
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  )
}
