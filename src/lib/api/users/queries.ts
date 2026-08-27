// ---------------------------------------------------------------------------
// src/lib/api/users/queries.ts
//
// Read side of Section 6.5 — the user roster. Gated on the **settings** module:
// `GET /users` needs `settings.read`, so an Owner and a Manager can both see the
// roster; a Cashier cannot. Every write needs a stronger grant (see mutations.ts).
//
// `passwordHash` and `mfaSecret` are not on this type because they are not in the
// response — the controller never emits a credential, and this mirror must not
// pretend otherwise. `roleName` rides alongside `roleId` so the table is readable
// without a second request; authorization still keys on the role's stored grants,
// never on the label.
// ---------------------------------------------------------------------------

import { api } from "../client"
import type { PaginatedEnvelope } from "../types"

/** One user, as `GET /users` returns it. */
export interface User {
  id: string
  email: string
  roleId: string
  /** The role's display name, joined in by the server for the list view. */
  roleName: string
  isActive: boolean
  /** Whether the user has enrolled a second factor — not the secret itself. */
  mfaEnabled: boolean
  /** ISO 8601. */
  createdAt: string
  updatedAt: string
}

export interface UserListParams {
  pageIndex?: number
  pageSize?: number
  /** `true`/`false` filters the roster; omit for all users. */
  isActive?: boolean
}

export const userKeys = {
  all: ["users"] as const,
  lists: () => [...userKeys.all, "list"] as const,
  list: (params: UserListParams) => [...userKeys.lists(), params] as const,
}

export function fetchUsers(
  params: UserListParams = {},
  signal?: AbortSignal,
): Promise<PaginatedEnvelope<User>> {
  return api.get<PaginatedEnvelope<User>>("/users", {
    query: { ...params },
    signal,
  })
}
