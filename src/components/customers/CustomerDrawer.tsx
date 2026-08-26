"use client"

// ---------------------------------------------------------------------------
// src/components/customers/CustomerDrawer.tsx
//
// Create/edit form, now submitting to the API.
//
// The client-side duplicate-email guard was **removed**, not ported. It compared
// against the customer array the page held, which under server-side pagination is
// one page — so it missed every duplicate not currently on screen while looking
// like validation. `@@unique([tenantId, email])` is the real guard and answers
// 409; that is caught below and shown on the email field.
//
// One behaviour that surprises if you do not know it: creating a customer with the
// email of a *soft-deleted* one revives that record rather than conflicting, so
// their order history comes back with them. The form does not need to do anything
// about it, but "email already exists" is not the only possible outcome of reusing
// an address.
// ---------------------------------------------------------------------------

import * as React from "react"
import { useForm, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"

import { customerSchema, CustomerValues } from "@/lib/validation/customers"
import type { Customer } from "@/lib/api/customers/queries"
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
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"

interface CustomerDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** `undefined` = create mode. */
  customer?: Customer
  /**
   * Resolves when the write has landed, rejects with the ApiError if it has not.
   * The drawer stays open on rejection so the user does not lose what they typed.
   */
  onSave: (values: CustomerValues, id?: string) => Promise<unknown>
}

const EMPTY: CustomerValues = {
  name: "",
  email: "",
  phone: "",
  address: "",
  notes: "",
  isActive: true,
}

function toFormValues(customer: Customer | undefined): CustomerValues {
  if (customer === undefined) return EMPTY
  return {
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    address: customer.address,
    notes: customer.notes,
    isActive: customer.isActive,
  }
}

/**
 * The form body, mounted only while the drawer is open.
 *
 * That separation is what makes the reset free. `SheetContent` renders through
 * Base UI's portal, whose `keepMounted` defaults to `false` — so its children are
 * unmounted while the drawer is closed and this component mounts fresh on every
 * open, seeded by `defaultValues` from whichever customer is being edited.
 *
 * The alternative is one long-lived form with a `form.reset()` in an effect keyed
 * on `open`. That arrives at the same state one render later, which means the
 * drawer opens showing the *previous* customer's values and corrects them after
 * paint — and it makes the reset a thing that has to fire correctly rather than a
 * consequence of mounting.
 */
function CustomerForm({
  customer,
  onSave,
  onDone,
}: {
  customer?: Customer
  onSave: (values: CustomerValues, id?: string) => Promise<unknown>
  onDone: () => void
}) {
  const isEdit = customer !== undefined
  const [formError, setFormError] = React.useState<string | null>(null)

  const form = useForm<CustomerValues>({
    // Asserted, not assigned: the schema's input type differs from its output type
    // (Zod v4 optional/coerce fields), so RHF cannot take the resolver directly.
    // `Resolver<CustomerValues>` narrows the assertion to one shape, unlike `any`.
    resolver: zodResolver(customerSchema) as unknown as Resolver<CustomerValues>,
    defaultValues: toFormValues(customer),
  })

  const onSubmit = async (data: CustomerValues) => {
    setFormError(null)
    try {
      await onSave(data, customer?.id)
      onDone()
    } catch (err) {
      if (!isApiError(err)) {
        setFormError("Could not reach the server. Nothing was saved.")
        return
      }
      if (err.isConflict) {
        form.setError("email", {
          type: "server",
          message: "A customer with this email already exists.",
        })
        return
      }
      if (err.isValidation) {
        // Field names match the form's one-for-one here, so the server's messages
        // can be attached directly.
        for (const [field, message] of Object.entries(err.fieldErrors())) {
          if (field in EMPTY) {
            form.setError(field as keyof CustomerValues, {
              type: "server",
              message,
            })
          }
        }
        return
      }
      if (err.isForbidden) {
        setFormError("You do not have permission to save customers.")
        return
      }
      setFormError(err.message)
    }
  }

  const saving = form.formState.isSubmitting

  return (
    <>
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
                  <Input placeholder="e.g. +92 300 1234567" {...field} />
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
                  <Input placeholder="e.g. 12 Jinnah Road, Lahore" {...field} />
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
              {saving
                ? "Saving…"
                : isEdit
                  ? "Save Changes"
                  : "Add Customer"}
            </Button>
          </SheetFooter>
        </form>
      </Form>
    </>
  )
}

export function CustomerDrawer({
  open,
  onOpenChange,
  customer,
  onSave,
}: CustomerDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md overflow-y-auto">
        <CustomerForm
          customer={customer}
          onSave={onSave}
          onDone={() => onOpenChange(false)}
        />
      </SheetContent>
    </Sheet>
  )
}
