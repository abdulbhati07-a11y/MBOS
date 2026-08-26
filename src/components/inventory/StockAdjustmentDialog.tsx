"use client"

// ---------------------------------------------------------------------------
// src/components/inventory/StockAdjustmentDialog.tsx
//
// Writes a row to the stock ledger via `POST /inventory/adjustments`.
//
// The client-side negative-stock check is kept, but it is a fast fail and not the
// guarantee. The server enforces PROV-BR-07 inside the same transaction that
// applies the movement and answers 409 — which is the only check that holds when
// two people adjust the same product at once, or when the count on screen is a few
// seconds stale. Both paths are handled: the local one so the common case never
// leaves the dialog, the 409 so the rare one is never silently lost.
//
// The dialog does not name the API's field. It emits `quantity` as an unsigned
// magnitude and lets the page rename it to `quantityDelta` at the boundary
// (DEBT-028), because the form's own guard, its preview arithmetic and its error
// messages all read in magnitudes.
// ---------------------------------------------------------------------------

import * as React from "react"
import { useForm, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { stockAdjustmentSchema, StockAdjustmentValues } from "@/lib/validation/inventory"
import { isApiError } from "@/lib/api/client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"

const DEFAULTS: StockAdjustmentValues = {
  type: "ADD",
  quantity: 1,
  reasonCode: "Received",
}

interface StockAdjustmentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  productName: string
  currentStock: number
  /**
   * Resolves when the ledger row is written, rejects with the ApiError if it is
   * not. Rejection keeps the dialog open — a stock adjustment the user believes
   * landed but did not is the one outcome worth guarding hardest against.
   */
  onConfirm: (data: StockAdjustmentValues) => Promise<unknown>
}

export function StockAdjustmentDialog({
  open,
  onOpenChange,
  productName,
  currentStock,
  onConfirm,
}: StockAdjustmentDialogProps) {
  const [formError, setFormError] = React.useState<string | null>(null)

  const form = useForm<StockAdjustmentValues>({
    // Asserted, not assigned: `z.coerce.number()` types its input as `unknown`, so
    // the schema's input type is not `StockAdjustmentValues`. Asserting through
    // `Resolver<StockAdjustmentValues>` keeps it to one shape rather than `any`.
    resolver: zodResolver(
      stockAdjustmentSchema,
    ) as unknown as Resolver<StockAdjustmentValues>,
    defaultValues: DEFAULTS,
  })

  // Reset form when dialog opens
  React.useEffect(() => {
    if (open) {
      form.reset(DEFAULTS)
      setFormError(null)
    }
  }, [open, form])

  const onSubmit = async (data: StockAdjustmentValues) => {
    setFormError(null)

    // PROV-BR-07: Prevent negative stock
    if (data.type === "REMOVE" && currentStock - data.quantity < 0) {
      form.setError("quantity", {
        type: "manual",
        message: `Cannot remove ${data.quantity} (only ${currentStock} in stock)`,
      })
      return
    }

    try {
      await onConfirm(data)
      onOpenChange(false)
    } catch (err) {
      if (!isApiError(err)) {
        setFormError("Could not reach the server. No adjustment was recorded.")
        return
      }
      if (err.isConflict) {
        // Insufficient stock, decided server-side against the live count. The
        // message names the real figure, which is more use than a restatement of
        // the stale one this dialog opened with.
        form.setError("quantity", { type: "server", message: err.message })
        return
      }
      if (err.isValidation) {
        // `quantityDelta` is this form's `quantity`; nothing else the server can
        // reject here maps to a visible field.
        const fields = err.fieldErrors()
        const quantityMessage = fields.quantityDelta ?? fields.quantity
        if (quantityMessage !== undefined) {
          form.setError("quantity", { type: "server", message: quantityMessage })
        } else {
          setFormError(err.message)
        }
        return
      }
      if (err.isForbidden) {
        setFormError("You do not have permission to adjust stock.")
        return
      }
      setFormError(err.message)
    }
  }

  const type = form.watch("type")
  const quantity = form.watch("quantity")
  const saving = form.formState.isSubmitting

  // Calculate resulting stock for preview
  let resultingStock = currentStock
  if (type === "ADD") resultingStock += (quantity || 0)
  if (type === "REMOVE") resultingStock -= (quantity || 0)
  if (type === "COUNT") resultingStock = (quantity || 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Adjust Stock</DialogTitle>
          <DialogDescription>
            Update inventory levels for <strong>{productName}</strong>.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem className="space-y-3">
                  <FormLabel>Operation Type</FormLabel>
                  <FormControl>
                    <RadioGroup
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                      className="flex flex-col space-y-1"
                    >
                      <FormItem className="flex items-center space-x-3 space-y-0">
                        <FormControl>
                          <RadioGroupItem value="ADD" />
                        </FormControl>
                        <FormLabel className="font-normal">Add to stock (Receive)</FormLabel>
                      </FormItem>
                      <FormItem className="flex items-center space-x-3 space-y-0">
                        <FormControl>
                          <RadioGroupItem value="REMOVE" />
                        </FormControl>
                        <FormLabel className="font-normal">Remove from stock (Damage/Loss)</FormLabel>
                      </FormItem>
                      <FormItem className="flex items-center space-x-3 space-y-0">
                        <FormControl>
                          <RadioGroupItem value="COUNT" />
                        </FormControl>
                        <FormLabel className="font-normal">Set absolute count (Inventory check)</FormLabel>
                      </FormItem>
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="quantity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {type === "COUNT" ? "Counted Quantity" : "Quantity"}
                    </FormLabel>
                    <FormControl>
                      <Input type="number" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="reasonCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reason Code</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a reason" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Received">Received</SelectItem>
                        <SelectItem value="Returned">Returned</SelectItem>
                        <SelectItem value="Damaged">Damaged</SelectItem>
                        <SelectItem value="Correction">Correction</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="rounded-md bg-muted p-3 text-sm">
              <div className="flex justify-between text-muted-foreground mb-1">
                <span>Current Stock:</span>
                <span>{currentStock}</span>
              </div>
              <div className="flex justify-between font-medium">
                <span>Resulting Stock:</span>
                <span className={resultingStock < 0 ? "text-destructive" : ""}>
                  {resultingStock}
                </span>
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

            <DialogFooter>
              <DialogClose
                render={
                  <Button type="button" variant="outline" disabled={saving}>
                    Cancel
                  </Button>
                }
              />
              <Button type="submit" disabled={saving}>
                {saving ? "Recording…" : "Confirm Adjustment"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
