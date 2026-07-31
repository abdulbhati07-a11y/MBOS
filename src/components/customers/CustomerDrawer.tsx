"use client"

import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { customerSchema, CustomerValues } from "@/lib/validation/customers"
import { CustomerRecord } from "@/lib/mock-data/customers"

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

interface CustomerDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  // undefined = Create mode; defined = Edit mode
  customer?: CustomerRecord
  // Full list used for duplicate-email guard (self-excluded in edit mode)
  customers: CustomerRecord[]
  onSave: (values: CustomerValues, id?: string) => void
}

export function CustomerDrawer({
  open,
  onOpenChange,
  customer,
  customers,
  onSave,
}: CustomerDrawerProps) {
  const isEdit = !!customer

  const form = useForm<CustomerValues>({
    // as any: known zodResolver + Zod v4 interop gap (same pattern as inventory)
    resolver: zodResolver(customerSchema) as any,
    defaultValues: customer
      ? {
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          address: customer.address,
          notes: customer.notes,
          isActive: customer.isActive,
        }
      : {
          name: "",
          email: "",
          phone: "",
          address: "",
          notes: "",
          isActive: true,
        },
  })

  // Reset whenever the drawer opens with a (potentially different) customer
  React.useEffect(() => {
    if (open) {
      form.reset(
        customer
          ? {
              name: customer.name,
              email: customer.email,
              phone: customer.phone,
              address: customer.address,
              notes: customer.notes,
              isActive: customer.isActive,
            }
          : {
              name: "",
              email: "",
              phone: "",
              address: "",
              notes: "",
              isActive: true,
            }
      )
    }
  }, [open, customer, form])

  const onSubmit = (data: CustomerValues) => {
    // [PROV-BR-CUST-01] Duplicate email guard — client-side only.
    // In edit mode, exclude the current record so an unchanged email
    // doesn't trigger a false-positive.
    const otherCustomers = customers.filter((c) => c.id !== customer?.id)
    const emailTaken = otherCustomers.some(
      (c) => c.email.toLowerCase() === data.email.toLowerCase()
    )
    if (emailTaken) {
      form.setError("email", {
        type: "manual",
        message: "A customer with this email already exists",
      })
      return
    }

    onSave(data, customer?.id)
    onOpenChange(false)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md overflow-y-auto">
        <SheetHeader className="mb-6">
          <SheetTitle>{isEdit ? "Edit Customer" : "Add Customer"}</SheetTitle>
          <SheetDescription>
            {isEdit
              ? "Update the customer's details below."
              : "Enter the details for the new customer."}
          </SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Full Name</FormLabel>
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
                    <Input type="email" placeholder="e.g. jane@example.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

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
                    <Input placeholder="e.g. +1 555-0100" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

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
                    <Input placeholder="e.g. 12 Maple Street, Springfield" {...field} />
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
                    <Input placeholder="Any relevant notes…" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* isActive toggle — Edit mode only. New customers always start Active. */}
            {isEdit && (
              <FormField
                control={form.control}
                name="isActive"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-md border p-3">
                    <div>
                      <FormLabel className="text-sm font-medium">Active</FormLabel>
                      <p className="text-xs text-muted-foreground">
                        Inactive customers remain in the list but are visually marked.
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
                {isEdit ? "Save Changes" : "Add Customer"}
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  )
}
