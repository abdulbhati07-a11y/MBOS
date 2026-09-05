// ---------------------------------------------------------------------------
// src/lib/api/roles/queries.ts
//
// Read side of Section 6.5 — roles and their permission grids. This is what
// finally lets the Roles screen show the REAL matrix (DEBT-006/DEBT-007): until
// now it rendered the client-side `DEFAULT_ROLE_PERMISSIONS` guess.
//
// Gated on the **settings** module: `GET /roles` and `GET /roles/:id/permissions`
// both need `settings.read`, so an Owner and a Manager can both read the matrix; a
// Cashier cannot. Writing it needs `settings.write` (see mutations.ts).
//
// A DELIBERATE STRING, NOT THE ENUM. `module` is typed `string`, not
// `@/config/permissions`'s `Modules`, because the server's grid includes
// `billing` — a module key the frontend enum has no member for (there is no
// billing UI beyond the settings-gated screen; DEBT-016). Rendering the grid from
// the server's own raw keys keeps this screen correct as the taxonomy grows,
// instead of silently dropping any pair the enum cannot name.
// ---------------------------------------------------------------------------

import { api } from "../client"
import type { PaginatedEnvelope } from "../types"

/** One role, as `GET /roles` returns it. Built-ins (Owner/Manager/Cashier) come first. */
export interface RoleSummary {
  id: string
  name: string
  /** Built-in roles are global (D-02): they cannot be edited or deleted. */
  isBuiltIn: boolean
}

/**
 * One cell of the permission grid, from `GET /roles/:id/permissions`.
 *
 * The server synthesises the negatives, so a `granted: false` entry is a real
 * "denied", not an absent row — the grid is complete and a checkbox editor can
 * render straight from it. `refund` appears for `sales` only (BR-03), so a client
 * that iterates a fixed action list must tolerate a missing (module, refund) pair
 * for every other module rather than invent one.
 */
export interface PermissionEntry {
  module: string
  action: string
  granted: boolean
}

export interface RoleListParams {
  pageIndex?: number
  pageSize?: number
}

export const roleKeys = {
  all: ["roles"] as const,
  lists: () => [...roleKeys.all, "list"] as const,
  list: (params: RoleListParams) => [...roleKeys.lists(), params] as const,
  permissions: () => [...roleKeys.all, "permissions"] as const,
  permission: (id: string) => [...roleKeys.permissions(), id] as const,
}

export function fetchRoles(
  params: RoleListParams = {},
  signal?: AbortSignal,
): Promise<PaginatedEnvelope<RoleSummary>> {
  return api.get<PaginatedEnvelope<RoleSummary>>("/roles", {
    query: { ...params },
    signal,
  })
}

/**
 * The complete grid for one role. Unwraps the `{ data }` envelope the endpoint
 * wraps its list in (Section 6.1's non-paginated list shape) so callers get the
 * array directly, matching every other fetcher here.
 */
export async function fetchRolePermissions(
  id: string,
  signal?: AbortSignal,
): Promise<PermissionEntry[]> {
  const res = await api.get<{ data: PermissionEntry[] }>(
    `/roles/${id}/permissions`,
    { signal },
  )
  return res.data
}
