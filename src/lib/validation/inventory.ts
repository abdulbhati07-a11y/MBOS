import * as z from "zod"

import { isMoneyMajor, MONEY_PRECISION_MESSAGE } from "./money"

// ---------------------------------------------------------------------------
// Product Schema (PROV-FR-INV-02)
//
// `price` and `cost` are held here in **major** units — rupees, as typed — and
// converted to integer minor units at the API boundary. The form keeps rupees
// because that is what an operator reads off a price tag; the wire keeps paisa
// because `POST /products` takes `priceCents` and refuses a float.
//
// The `.refine` on each is what makes that conversion safe. `parseMoneyToMinor`
// returns null for over-precision like "29.999", and without this refinement that
// null would only surface at submit time as an unexplained failure. Catching it as
// a field error means the message lands under the field that caused it.
// ---------------------------------------------------------------------------

export const productSchema = z.object({
  name: z.string().min(2, { message: "Name must be at least 2 characters" }),
  sku: z.string().min(3, { message: "SKU must be at least 3 characters" }), // PROV-BR-03
  category: z.string().min(1, { message: "Category is required" }),
  price: z.coerce
    .number()
    .min(0, { message: "Price must be positive" })
    .refine(isMoneyMajor, { message: MONEY_PRECISION_MESSAGE }),
  cost: z.coerce
    .number()
    .min(0, { message: "Cost must be positive" })
    .refine(isMoneyMajor, { message: MONEY_PRECISION_MESSAGE }),
  uom: z.string().min(1, { message: "Unit of measure is required" }),
  reorderPoint: z.coerce.number().int().min(0, { message: "Reorder point must be 0 or greater" }),

  // Creation-only field, not used when editing an existing product
  initialStock: z.coerce.number().int().min(0).default(0),
})

export type ProductValues = z.infer<typeof productSchema>


// ---------------------------------------------------------------------------
// Stock Adjustment Schema (PROV-FR-INV-04)
//
// The field is `quantity` here and `quantityDelta` on the wire, and the two are
// not the same thing: this one is always an unsigned magnitude (or, for COUNT, an
// absolute level), while the stored column is signed so the ledger sums. The
// request body uses the unsigned form too — `{ type: "REMOVE", quantityDelta: 5 }`
// — so a client cannot file "ADD -5". The rename happens at the API boundary
// (DEBT-028).
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
// doesn't bring current stock below 0 (PROV-BR-07). The server enforces it too, and
// answers 409 — the client check is a fast fail, not the guarantee.

export type StockAdjustmentValues = z.infer<typeof stockAdjustmentSchema>
