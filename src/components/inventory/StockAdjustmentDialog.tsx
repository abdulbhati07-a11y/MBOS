"use client"

import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { stockAdjustmentSchema, StockAdjustmentValues } from "@/lib/validation/inventory"

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

interface StockAdjustmentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  productName: string
  currentStock: number
}

export function StockAdjustmentDialog({
  open,
  onOpenChange,
  productName,
  currentStock,
}: StockAdjustmentDialogProps) {
  const form = useForm<StockAdjustmentValues>({
    // as any: known zodResolver + z.coerce interop gap, not a real type error
    // z.coerce.number() has input=unknown / output=number; @hookform/resolvers can't reconcile that yet
    resolver: zodResolver(stockAdjustmentSchema) as any,
    defaultValues: {
      type: "ADD",
      quantity: 1,
      reasonCode: "Received",
    },
  })

  // Reset form when dialog opens
  React.useEffect(() => {
    if (open) {
      form.reset({
        type: "ADD",
        quantity: 1,
        reasonCode: "Received",
      })
    }
  }, [open, form])

  const onSubmit = (data: StockAdjustmentValues) => {
    // PROV-BR-07: Prevent negative stock
    if (data.type === "REMOVE" && currentStock - data.quantity < 0) {
      form.setError("quantity", {
        type: "manual",
        message: `Cannot remove ${data.quantity} (only ${currentStock} in stock)`,
      })
      return
    }

    console.log("Adjust Stock:", { product: productName, ...data })
    onOpenChange(false)
  }

  const type = form.watch("type")
  const quantity = form.watch("quantity")

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
                    <FormLabel>Quantity</FormLabel>
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

            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline">Cancel</Button>} />
              <Button type="submit">Confirm Adjustment</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
