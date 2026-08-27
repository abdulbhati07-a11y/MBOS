// ---------------------------------------------------------------------------
// src/lib/api/roles/mutations.ts
//
// Write side of Section 6.5 — creating custom roles, deleting them, and
// replacing a role's permission grid.
//
// Permission split, straight from the section: POST and PUT need
// `settings.write`, DELETE needs `settings.delete`. Under the built-in matrix a
// Manager holds only `settings.read`, so every write here is Owner-only — gate
// the create/save/delete controls on write and delete respectively, not on the
// read that shows the screen.
//
// Two rejections a caller must expect and message, not swallow:
//   - a built-in role answers 403 to DELETE and to PUT /permissions — it is
//     global and shared, and its matrix is canonical (D-02);
//   - a custom role still held by users answers 409 to DELETE.
// ---------------------------------------------------------------------------

import { api } from "../client"
import type { PermissionEntry, RoleSummary } from "./queries"

/**
 * Body of `POST /roles`. Name only: the server takes `tenantId` from the JWT and
 * refuses `isBuiltIn`, and the pipe runs `forbidNonWhitelisted`, so sending
 * either extra field fails the whole request with 422. A name colliding with a
 * built-in ("Owner") or an existing custom role comes back 409.
 */
export interface CreateRoleInput {
  /** 1–60 characters, server-enforced. */
  name: string
}

export function createRole(input: CreateRoleInput): Promise<RoleSummary> {
  return api.post<RoleSummary>("/roles", input)
}

/**
 * Soft delete. Returns the (now-removed) role rather than 204. 403 for a built-in,
 * 409 when a user still holds it — reassign those users first.
 */
export function deleteRole(id: string): Promise<RoleSummary> {
  return api.del<RoleSummary>(`/roles/${id}`)
}

/**
 * `PUT /roles/:id/permissions` — replaces the WHOLE grid, not a patch: a pair
 * omitted from the body is revoked, which is what makes the call idempotent and
 * safe to re-send. Send the full grid the GET returned with its booleans edited.
 *
 * Only `granted: true` pairs are actually stored server-side, but sending the
 * `false` ones too is correct and expected — echoing the exact grid the GET gave
 * (which already excludes `refund` on non-sales modules) means the body can never
 * trip the 422 the endpoint raises for a meaningless `x.refund` pair.
 */
export async function replaceRolePermissions(
  id: string,
  permissions: PermissionEntry[],
): Promise<PermissionEntry[]> {
  const res = await api.put<{ data: PermissionEntry[] }>(
    `/roles/${id}/permissions`,
    { permissions },
  )
  return res.data
}
