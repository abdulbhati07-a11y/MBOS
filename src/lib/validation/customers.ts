// ---------------------------------------------------------------------------
// src/lib/validation/customers.ts
// ---------------------------------------------------------------------------
import * as z from "zod"

export const customerSchema = z.object({
  name: z.string().min(2, { message: "Name must be at least 2 characters" }),
  email: z.string().email({ message: "Please enter a valid email address" }),
  phone: z.string().optional().default(""),
  address: z.string().optional().default(""),
  notes: z.string().optional().default(""),
  // isActive is only surfaced in the form during Edit mode.
  // New customers always start Active (defaulted by the form, not Zod).
  isActive: z.boolean().default(true),
})

export type CustomerValues = z.infer<typeof customerSchema>
