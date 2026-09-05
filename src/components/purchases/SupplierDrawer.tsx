"use client"

// ---------------------------------------------------------------------------
// src/components/purchases/SupplierDrawer.tsx
//
// Create/edit form, submitting to the API.
//
// The client-side duplicate-email guard was **removed**, not ported — same reason
// as customers: it compared against the one page of suppliers the table held, so
// it missed every duplicate not on screen while looking like validation. The
// server's unique constraint is the real guard; a 409 is caught below and shown
// on the email field.
// ---------------------------------------------------------------------------

import * as React from "react"
import { useForm, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"

import { supplierSchema, SupplierValues } from "@/lib/validation/purchases"
import type { Supplier } from "@/lib/api/suppliers/queries"
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

interface SupplierDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** `undefined` = create mode. */
  supplier?: Supplier
  /**
   * Resolves when the write has landed, rejects with the ApiError if it has not.
   * The drawer stays open on rejection so the user does not lose what they typed.
   */
  onSave: (values: SupplierValues, id?: string) => Promise<unknown>
}

const EMPTY: SupplierValues = {
  name: "",
  contactPerson: "",
  email: "",
  phone: "",
  address: "",
  categories: "",
  notes: "",
  isActive: true,
}

function toFormValues(supplier: Supplier | undefined): SupplierValues {
  if (supplier === undefined) return EMPTY
  return {
    name: supplier.name,
    contactPerson: supplier.contactPerson,
    email: supplier.email,
    phone: supplier.phone,
    address: supplier.address,
    categories: supplier.categories,
    notes: supplier.notes,
    isActive: supplier.isActive,
  }
}

/**
 * The form body, mounted only while the drawer is open — so it seeds fresh from
 * `defaultValues` on every open rather than resetting a render late. See the same
 * note on `CustomerDrawer` for why this beats a `form.reset()` effect.
 */
function SupplierForm({
  supplier,
  onSave,
  onDone,
}: {
  supplier?: Supplier
  onSave: (values: SupplierValues, id?: string) => Promise<unknown>
  onDone: () => void
}) {
  const isEdit = supplier !== undefined
  const [formError, setFormError] = React.useState<string | null>(null)

  const form = useForm<SupplierValues>({
    // Asserted, not assigned: the schema's input type differs from its output type
    // (Zod v4 optional/default fields), so RHF cannot take the resolver directly.
    // `Resolver<SupplierValues>` narrows the assertion to one shape, unlike `any`.
    resolver: zodResolver(supplierSchema) as unknown as Resolver<SupplierValues>,
    defaultValues: toFormValues(supplier),
  })

  const onSubmit = async (data: SupplierValues) => {
    setFormError(null)
    try {
      await onSave(data, supplier?.id)
      onDone()
    } catch (err) {
      if (!isApiError(err)) {
        setFormError("Could not reach the server. Nothing was saved.")
        return
      }
      if (err.isConflict) {
        form.setError("email", {
          type: "server",
          message: "A supplier with this email already exists.",
        })
        return
      }
      if (err.isValidation) {
        // Field names match the form's one-for-one, so the server's messages can
        // be attached directly.
        for (const [field, message] of Object.entries(err.fieldErrors())) {
          if (field in EMPTY) {
            form.setError(field as keyof SupplierValues, {
              type: "server",
              message,
            })
          }
        }
        return
      }
      if (err.isForbidden) {
        setFormError("You do not have permission to save suppliers.")
        return
      }
      setFormError(err.message)
    }
  }

  const saving = form.formState.isSubmitting

  return (
    <>
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
                    <Input placeholder="+92 300 1234567" {...field} />
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

          {/* isActive toggle — Edit mode only. New suppliers always start Active. */}
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
              {saving ? "Saving…" : isEdit ? "Save Changes" : "Add Supplier"}
            </Button>
          </SheetFooter>
        </form>
      </Form>
    </>
  )
}

export function SupplierDrawer({
  open,
  onOpenChange,
  supplier,
  onSave,
}: SupplierDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md overflow-y-auto">
        <SupplierForm
          supplier={supplier}
          onSave={onSave}
          onDone={() => onOpenChange(false)}
        />
      </SheetContent>
    </Sheet>
  )
}
