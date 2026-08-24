import { Prisma } from '../generated/prisma/client';

/**
 * The one definition of "roles this tenant may see": global built-ins plus its
 * own, never another tenant's, never soft-deleted.
 *
 * `Role` is excluded from SCOPED_MODELS because built-in roles carry
 * `tenantId = null`, so the Prisma extension cannot supply this filter — an
 * injected `tenantId` would hide exactly the three roles every tenant depends on.
 * That makes the boundary something callers must state, and a caller that states
 * it slightly differently opens a cross-tenant hole. So it is written once, here,
 * and imported by RolesService, UsersService, and anything else that resolves a
 * role id. PermissionGuard performs the equivalent check inline on the hot path.
 */
export function visibleRoleWhere(tenantId: string): Prisma.RoleWhereInput {
  return {
    deletedAt: null,
    OR: [{ tenantId: null }, { tenantId }],
  };
}
