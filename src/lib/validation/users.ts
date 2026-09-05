// ---------------------------------------------------------------------------
// src/lib/validation/users.ts
//
// Client-side schemas for the Section 6.5 user- and role-management forms. These
// are the first line of feedback; the server re-validates every rule and its 422s
// are mapped back onto the fields, so a rule here is advice that saves a round
// trip, never the authority.
// ---------------------------------------------------------------------------

import * as z from "zod"

/**
 * The Section 3.3.1 password policy, transcribed from the backend's
 * `IsPolicyPassword` and the auth flow's own `passwordSchema` character for
 * character. There is no shared source across the two projects yet (DEBT-016), so
 * the three copies are kept identical by hand — change one, change all three.
 */
const passwordSchema = z
  .string()
  .min(8, { message: "Password must be at least 8 characters long" })
  .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/, {
    message:
      "Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character",
  })

/**
 * Create a user. The password is required here (invite-by-email is not built —
 * DEBT-015) and validated against the policy; on edit it is absent entirely, so
 * that path uses `editUserSchema`.
 */
export const createUserSchema = z.object({
  email: z.string().email({ message: "Please enter a valid email address" }),
  password: passwordSchema,
  roleId: z.string().min(1, { message: "Please select a role" }),
  isActive: z.boolean().default(true),
})

/** Edit a user — identity and role only. No password: that is a separate flow. */
export const editUserSchema = z.object({
  email: z.string().email({ message: "Please enter a valid email address" }),
  roleId: z.string().min(1, { message: "Please select a role" }),
  isActive: z.boolean().default(true),
})

export type CreateUserValues = z.infer<typeof createUserSchema>
export type EditUserValues = z.infer<typeof editUserSchema>

/**
 * Create a custom role. Name only — 1–60 characters, matching the server DTO. The
 * "is this a built-in name?" and "does this already exist?" checks are the
 * server's (they need the full role set), surfaced here as a 409 on the field.
 */
export const createRoleSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { message: "Role name is required" })
    .max(60, { message: "Role name must be 60 characters or fewer" }),
})

export type CreateRoleValues = z.infer<typeof createRoleSchema>
