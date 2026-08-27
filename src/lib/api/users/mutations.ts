// ---------------------------------------------------------------------------
// src/lib/api/users/mutations.ts
//
// Write side of Section 6.5 — create, update, and remove users.
//
// Permission split, from the section: POST and PATCH need `settings.write`,
// DELETE needs `settings.delete`. Under the built-in matrix that makes every
// write Owner-only; a Manager can read the roster but not change it.
//
// Three self-protection rules the server enforces, each a 403 with a message the
// UI should surface verbatim rather than a generic failure:
//   - you cannot change your OWN role (another Owner must),
//   - you cannot deactivate your OWN account,
//   - you cannot delete your OWN account.
// They stop the last Owner from locking the tenant out of its own administration.
// A duplicate email is 409; an unassignable role (another tenant's, or deleted)
// is 422.
// ---------------------------------------------------------------------------

import { api } from "../client"
import type { User } from "./queries"

/**
 * Body of `POST /users`. Every key is on the server DTO — `forbidNonWhitelisted`
 * turns a stray property into a 422, so send exactly these.
 *
 * A password is REQUIRED, not optional: Section 6.5 calls this "create/invite",
 * but invite-by-email needs a mail transport that does not exist yet (DEBT-015),
 * so there is no invite path that sets a password later. It is validated against
 * the Section 3.3.1 policy server-side (min 8, upper/lower/digit/special).
 */
export interface CreateUserInput {
  email: string
  password: string
  /** A built-in role id or one of this tenant's own; anything else is 422. */
  roleId: string
  /** Defaults to `true` server-side when omitted. */
  isActive?: boolean
}

/**
 * Body of `PATCH /users/:id`. Every field optional; an omitted field is left
 * alone. There is deliberately no `password` — an admin reset is a separate
 * operation, and a user's own change belongs to the Section 6.3 reset flow.
 */
export interface UpdateUserInput {
  email?: string
  roleId?: string
  isActive?: boolean
}

export function createUser(input: CreateUserInput): Promise<User> {
  return api.post<User>("/users", input)
}

export function updateUser(id: string, input: UpdateUserInput): Promise<User> {
  return api.patch<User>(`/users/${id}`, input)
}

/**
 * Soft delete. Returns the (now-removed) user rather than 204 and revokes their
 * refresh tokens server-side. 403 when you target your own account.
 */
export function deleteUser(id: string): Promise<User> {
  return api.del<User>(`/users/${id}`)
}
