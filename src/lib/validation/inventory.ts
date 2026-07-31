import * as z from "zod"

// ---------------------------------------------------------------------------
// Product Schema (PROV-FR-INV-02)
// ---------------------------------------------------------------------------
export const productSchema = z.object({
  name: z.string().min(2, { message: "Name must be at least 2 characters" }),
  sku: z.string().min(3, { message: "SKU must be at least 3 characters" }), // PROV-BR-03
  category: z.string().min(1, { message: "Category is required" }),
  price: z.coerce.number().min(0, { message: "Price must be positive" }),
  cost: z.coerce.number().min(0, { message: "Cost must be positive" }),
  uom: z.string().min(1, { message: "Unit of measure is required" }),
  reorderPoint: z.coerce.number().int().min(0, { message: "Reorder point must be 0 or greater" }),
  
  // Creation-only field, not used when editing an existing product
  initialStock: z.coerce.number().int().min(0).default(0), 
})

export type ProductValues = z.infer<typeof productSchema>


// ---------------------------------------------------------------------------
// Stock Adjustment Schema (PROV-FR-INV-04)
// ---------------------------------------------------------------------------
export const stockAdjustmentSchema = z.object({
  type: z.enum(["ADD", "REMOVE", "COUNT"], {
    message: "Please select an operation type",
  }),
  // PROV-BR-08: Enforce integers only for now
  quantity: z.coerce.number().int(),
  reasonCode: z.enum(["Received", "Damaged", "Correction", "Returned"], {
    message: "Please select a reason code",
  }),
}).superRefine((data, ctx) => {
  if (data.type === "COUNT") {
    if (data.quantity < 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Quantity must be 0 or greater", path: ["quantity"] })
    }
  } else {
    if (data.quantity < 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Quantity must be at least 1", path: ["quantity"] })
    }
  }
})

// Note: The caller (the form component) must cross-validate that a REMOVE operation 
// doesn't bring current stock below 0 (PROV-BR-07).

export type StockAdjustmentValues = z.infer<typeof stockAdjustmentSchema>
