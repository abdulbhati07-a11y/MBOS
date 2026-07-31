import * as z from "zod"

// ---------------------------------------------------------------------------
// Order Line Schema (PROV-FR-SALE-03)
// lineTotal is computed client-side, not validated by Zod
// ---------------------------------------------------------------------------
export const orderLineSchema = z.object({
  productId: z.string().min(1),
  productName: z.string().min(1),
  unitPrice: z.number().min(0),
  quantity: z.number().int().min(1, { message: "Quantity must be at least 1" }),
  // lineTotal is derived (unitPrice * quantity) — kept here for typing convenience
  lineTotal: z.number().min(0),
})

export type OrderLineValues = z.infer<typeof orderLineSchema>

// ---------------------------------------------------------------------------
// New Order Schema (PROV-FR-SALE-02)
// ---------------------------------------------------------------------------
export const newOrderSchema = z.object({
  customerName: z.string().optional().default("Walk-in"),
  paymentMethod: z.enum(["Cash", "Card", "Mobile"], {
    message: "Please select a payment method",
  }),
  taxRate: z.number().min(0).max(100).default(0),
  lines: z
    .array(orderLineSchema)
    .min(1, { message: "Order must have at least one item" }),
})

export type NewOrderValues = z.infer<typeof newOrderSchema>
