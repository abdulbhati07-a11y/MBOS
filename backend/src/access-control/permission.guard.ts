import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { PermissionRequirement } from './access-control.decorators';

/**
 * Step 6 of the middleware chain (Section 6.2) — role-based access control.
 *
 * Authorization is decided by the `RolePermission` table, never by the role's
 * name. `roleName` travels in the JWT for the frontend's convenience only
 * (jwt.types.ts says as much), so a token claiming "Owner" grants nothing on its
 * own; what matters is the rows attached to its `roleId`.
 *
 * Separate from step 5 on purpose. A tenant subscribing to Sales does not give
 * every user `sales.refund`, and holding `sales.refund` does not help if the
 * tenant has no Sales subscription. Both gates must pass.
 */
@Injectable()
export class PermissionGuard {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async assertPermission(requirement: PermissionRequirement): Promise<void> {
    const context = this.tenantContext.get();
    if (!context) {
      throw new Error(
        'PermissionGuard ran before the tenant context was bound. It must be ' +
          'invoked after the auth guard (chain steps 3-4).',
      );
    }

    // The UNSCOPED client, deliberately. Role and RolePermission are excluded
    // from SCOPED_MODELS (see tenant-scope.extension.ts): built-in roles carry
    // tenantId = null, so an injected `tenantId` filter would hide exactly the
    // three roles every tenant relies on. The tenant boundary is re-established
    // explicitly below instead of by the extension.
    const role = await this.prisma.role.findUnique({
      where: { id: context.roleId },
      select: {
        tenantId: true,
        permissions: {
          where: {
            module: requirement.module,
            action: requirement.action,
            granted: true,
          },
          select: { id: true },
        },
      },
    });

    if (!role) {
      throw new ForbiddenException('The assigned role no longer exists.');
    }

    // Hardening beyond Section 6.2. `roleId` arrives from a signed token minted
    // from the user's own record, so normally it is theirs — but if a token ever
    // carried another tenant's custom roleId (a stale token issued before a role
    // was moved, or a forged one should the signing key leak), an unscoped lookup
    // by id alone would happily honour that tenant's permissions. A role is
    // acceptable only if it is a global built-in or belongs to this tenant.
    const isGlobalBuiltIn = role.tenantId === null;
    const belongsToTenant = role.tenantId === context.tenantId;
    if (!isGlobalBuiltIn && !belongsToTenant) {
      throw new ForbiddenException('The assigned role is not valid here.');
    }

    if (role.permissions.length === 0) {
      // Section 6.2: "If not granted: returns 403." Naming the requirement helps
      // a developer debug their own call without disclosing the full matrix.
      throw new ForbiddenException(
        `This role lacks the ${requirement.module}.${requirement.action} permission.`,
      );
    }
  }
}
