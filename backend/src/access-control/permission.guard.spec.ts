import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  TenantContext,
  TenantContextService,
} from '../tenancy/tenant-context.service';
import { PermissionGuard } from './permission.guard';

/**
 * Unit coverage for chain step 6, including the cross-tenant role check that
 * Section 6.2 does not specify but that an unscoped lookup by id requires.
 */
describe('PermissionGuard', () => {
  const TENANT_ID = 'tenant-1';
  const ROLE_ID = 'role-1';

  let findUnique: jest.Mock;
  let get: jest.Mock;
  let guard: PermissionGuard;

  const context: TenantContext = {
    tenantId: TENANT_ID,
    userId: 'user-1',
    roleId: ROLE_ID,
    role: 'Manager',
  };

  beforeEach(() => {
    findUnique = jest.fn();
    get = jest.fn().mockReturnValue(context);

    const prisma = { role: { findUnique } } as unknown as PrismaService;
    const tenantContext = { get } as unknown as TenantContextService;

    guard = new PermissionGuard(prisma, tenantContext);
  });

  const requirement = { module: 'sales', action: 'refund' } as const;

  it('allows a built-in role holding the permission', async () => {
    // tenantId null = global built-in (Section 5.3).
    findUnique.mockResolvedValue({
      tenantId: null,
      permissions: [{ id: 'perm-1' }],
    });

    await expect(guard.assertPermission(requirement)).resolves.toBeUndefined();
  });

  it('allows a tenant-owned custom role holding the permission', async () => {
    findUnique.mockResolvedValue({
      tenantId: TENANT_ID,
      permissions: [{ id: 'perm-1' }],
    });

    await expect(guard.assertPermission(requirement)).resolves.toBeUndefined();
  });

  it('rejects a role without the permission', async () => {
    findUnique.mockResolvedValue({ tenantId: null, permissions: [] });

    await expect(guard.assertPermission(requirement)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('rejects a role belonging to another tenant', async () => {
    // The permission is granted, so only the tenant check can stop this. A
    // stale or forged token carrying another tenant's custom roleId must not
    // borrow that tenant's permissions.
    findUnique.mockResolvedValue({
      tenantId: 'tenant-2',
      permissions: [{ id: 'perm-1' }],
    });

    await expect(guard.assertPermission(requirement)).rejects.toThrow(
      /not valid here/,
    );
  });

  it('rejects a roleId that no longer exists', async () => {
    findUnique.mockResolvedValue(null);

    await expect(guard.assertPermission(requirement)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('filters on granted: true in the query, not in JS', async () => {
    findUnique.mockResolvedValue({
      tenantId: null,
      permissions: [{ id: 'perm-1' }],
    });

    await guard.assertPermission(requirement);

    // A revoked row (granted: false) must not come back at all; relying on a
    // post-hoc check would make an empty-vs-revoked mix-up easy to introduce.
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: ROLE_ID },
      select: {
        tenantId: true,
        permissions: {
          where: { module: 'sales', action: 'refund', granted: true },
          select: { id: true },
        },
      },
    });
  });

  it('fails closed when no tenant context is bound', async () => {
    get.mockReturnValue(undefined);

    await expect(guard.assertPermission(requirement)).rejects.toThrow(
      /before the tenant context was bound/,
    );
    expect(findUnique).not.toHaveBeenCalled();
  });
});
