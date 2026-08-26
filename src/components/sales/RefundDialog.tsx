"use client"

// ---------------------------------------------------------------------------
// src/components/sales/RefundDialog.tsx
//
// `POST /orders/:id/refund`, which needs `sales.refund` — a permission granted
// separately from `sales.write` (BR-03 at the RBAC layer), because taking money
// back is not the same authority as taking it.
//
// The amount is entered in rupees and sent in paisa. It is deliberately **not**
// capped client-side at what looks refundable: the figure shown here comes from
// whenever the order was last read, and another till may have refunded against the
// same order since. The server's 409 sees the refunds actually recorded and is the
// only check that can be right, so this form's job is to surface that answer on the
// amount field rather than to pre-empt it with a guess.
// ---------------------------------------------------------------------------

import * as React from "react"
import { useForm, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useQueryClient } from "@tanstack/react-query"

import { refundSchema, RefundValues } from "@/lib/validation/sales"
import { refundOrder } from "@/lib/api/sales/mutations"
import { orderKeys, type OrderDetail } from "@/lib/api/sales/queries"
import { customerKeys } from "@/lib/api/customers/queries"
import { formatMoneyMinor, parseMoneyToMinor } from "@/lib/format/currency"
import { isApiError } from "@/lib/api/client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"

interface RefundDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** `null` while no order is selected; the dialog renders nothing useful then. */
  order: OrderDetail | null
  /** What is still refundable per the last read, in minor units. Advisory. */
  refundableCents: number
}

/**
 * The refund form, mounted only while the dialog is open with an order.
 *
 * `DialogContent` renders through Base UI's portal, whose `keepMounted` defaults to
 * `false`, so this unmounts on close and mounts fresh on open — which is why
 * `defaultValues` is enough to seed the amount and no `form.reset()` effect is
 * needed. That also means `order` is non-null for the whole lifetime of this
 * component, so nothing below has to guard against it.
 */
function RefundForm({
  order,
  refundableCents,
  onDone,
}: {
  order: OrderDetail
  refundableCents: number
  onDone: () => void
}) {
  const queryClient = useQueryClient()
  const [formError, setFormError] = React.useState<string | null>(null)

  const form = useForm<RefundValues>({
    // `zodResolver` cannot be assigned directly here, and the reason is worth
    // stating because it looks like a bug: `z.coerce.number()` types its *input* as
    // `unknown` (it accepts anything and coerces), so the schema's input type and
    // `RefundValues` — its output type — are not the same type. React Hook Form
    // wants one type for both.
    //
    // The assertion goes through `Resolver<RefundValues>` rather than `any` so it
    // asserts one specific shape instead of switching off checking for everything
    // downstream: if `RefundValues` gains a field, this still describes the right
    // resolver. The alternative — dropping `z.coerce` and reading `valueAsNumber`
    // off every numeric input — moves the same coercion into every form by hand.
    resolver: zodResolver(refundSchema) as unknown as Resolver<RefundValues>,
    // The full remaining balance is the overwhelmingly common case — a whole
    // return — so it is what the field opens with.
    defaultValues: { amount: refundableCents / 100, reason: "" },
  })

  const onSubmit = async (data: RefundValues) => {
    setFormError(null)

    const amountCents = parseMoneyToMinor(data.amount)
    if (amountCents === null) {
      form.setError("amount", { message: "Use at most two decimal places" })
      return
    }

    try {
      await refundOrder(order.id, {
        amountCents,
        ...(data.reason.trim() === "" ? {} : { reason: data.reason.trim() }),
      })

      // The order's own detail, the sales list (its status and net move), and the
      // customer's history if the sale was attributed.
      await queryClient.invalidateQueries({ queryKey: orderKeys.all })
      if (order.customerId !== null) {
        void queryClient.invalidateQueries({ queryKey: customerKeys.all })
      }

      onDone()
    } catch (err) {
      if (!isApiError(err)) {
        setFormError("Could not reach the server. No refund was recorded.")
        return
      }
      if (err.isConflict) {
        // The overshoot case: refunds on this order would exceed its total. It is
        // an amount problem, so it belongs on the amount field, and the server's
        // message names the real remaining balance.
        form.setError("amount", { message: err.message })
        return
      }
      if (err.isValidation) {
        const fieldErrors = err.fieldErrors()
        let matched = false
        for (const [field, message] of Object.entries(fieldErrors)) {
          if (field === "amountCents") {
            form.setError("amount", { message })
            matched = true
          } else if (field === "reason") {
            form.setError("reason", { message })
            matched = true
          }
        }
        if (!matched) setFormError(err.message)
        return
      }
      if (err.isForbidden) {
        setFormError("You do not have permission to issue refunds.")
        return
      }
      setFormError(err.message)
    }
  }

  const submitting = form.formState.isSubmitting

  return (
    <>
      <DialogHeader>
        <DialogTitle>Refund {order.orderNumber}</DialogTitle>
        <DialogDescription>
          {formatMoneyMinor(refundableCents)} of{" "}
          {formatMoneyMinor(order.totalCents)} is still refundable.
        </DialogDescription>
      </DialogHeader>

      <Form {...form}>
        <form
          id="refund-form"
          onSubmit={form.handleSubmit(onSubmit)}
          className="space-y-4"
        >
          <FormField
            control={form.control}
            name="amount"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Amount</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    inputMode="decimal"
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  Partial refunds are allowed. Each one is recorded separately, so
                  an order can be refunded in stages.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="reason"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Reason</FormLabel>
                <FormControl>
                  <Textarea
                    rows={3}
                    placeholder="Damaged on arrival, wrong size, customer changed their mind…"
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  Optional, but a refund with no stated reason leaves a gap in the
                  audit trail that cannot be filled in later.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          {formError !== null && (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {formError}
            </p>
          )}
        </form>
      </Form>

      <DialogFooter showCloseButton>
        <Button
          type="submit"
          form="refund-form"
          variant="destructive"
          disabled={submitting}
        >
          {submitting ? "Recording…" : "Record Refund"}
        </Button>
      </DialogFooter>
    </>
  )
}

export function RefundDialog({
  open,
  onOpenChange,
  order,
  refundableCents,
}: RefundDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {order === null ? (
          <DialogHeader>
            <DialogTitle>Refund order</DialogTitle>
            <DialogDescription>No order selected.</DialogDescription>
          </DialogHeader>
        ) : (
          <RefundForm
            order={order}
            refundableCents={refundableCents}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
