// ---------------------------------------------------------------------------
// src/lib/validation/purchases.ts
// ---------------------------------------------------------------------------
import * as z from "zod"

// ---------------------------------------------------------------------------
// Supplier Schema [PROV-FR-PUR-02]
// ---------------------------------------------------------------------------
export const supplierSchema = z.object({
  name: z.string().min(2, { message: "Company name must be at least 2 characters" }),
  contactPerson: z.string().min(2, { message: "Contact name must be at least 2 characters" }),
  email: z.string().email({ message: "Please enter a valid email address" }),
  phone: z.string().optional().default(""),
  address: z.string().optional().default(""),
  categories: z.string().optional().default(""),
  notes: z.string().optional().default(""),
  // isActive surfaced in Edit mode only; new suppliers always start Active.
  isActive: z.boolean().default(true),
})

export type SupplierValues = z.infer<typeof supplierSchema>

// ---------------------------------------------------------------------------
// PO Line Schema [PROV-FR-PUR-04]
// lineTotal is computed client-side; not validated by Zod.
// unitCost is buyer-entered and independent of product.cost.
// ---------------------------------------------------------------------------
export const poLineSchema = z.object({
  productId: z.string().min(1),
  productName: z.string().min(1),
  unitCost: z.number().min(0, { message: "Unit cost must be 0 or greater" }),
  quantity: z.number().int().min(1, { message: "Quantity must be at least 1" }),
  lineTotal: z.number().min(0),
})

export type POLineValues = z.infer<typeof poLineSchema>

// ---------------------------------------------------------------------------
// New PO Schema [PROV-FR-PUR-04]
//
// The supplier is bound by **id**, not name: the API takes a `supplierId` FK, and
// two suppliers can share a name. The Select's option values are supplier ids.
// ---------------------------------------------------------------------------
export const newPOSchema = z.object({
  supplierId: z.string().min(1, { message: "Please select a supplier" }),
  notes: z.string().optional().default(""),
  lines: z
    .array(poLineSchema)
    .min(1, { message: "Purchase order must have at least one item" }),
})

export type NewPOValues = z.infer<typeof newPOSchema>
