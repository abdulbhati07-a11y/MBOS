import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { ModuleAccessGuard } from './module-access.guard';

/**
 * Unit coverage for chain step 5. Prisma and the tenant context are stubbed, so
 * every branch — including the ones that are awkward to reach against real data
 * (a row that exists but is disabled) — is exercised directly.
 */
describe('ModuleAccessGuard', () => {
  const TENANT_ID = 'tenant-1';
  let findFirst: jest.Mock;
  let getTenantId: jest.Mock;
  let guard: ModuleAccessGuard;

  beforeEach(() => {
    findFirst = jest.fn();
    getTenantId = jest.fn().mockReturnValue(TENANT_ID);

    const prisma = {
      db: { tenantModuleSubscription: { findFirst } },
    } as unknown as PrismaService;
    const context = { getTenantId } as unknown as TenantContextService;

    guard = new ModuleAccessGuard(prisma, context);
  });

  it('allows an industry module with an enabled subscription', async () => {
    findFirst.mockResolvedValue({ disabledAt: null });

    await expect(
      guard.assertModuleEnabled('pharmacy'),
    ).resolves.toBeUndefined();
  });

  it('allows a core module without consulting the subscription table', async () => {
    // DEBT-016: core modules are RBAC-only and never carry a subscription row,
    // so the guard must not query for one — the permission check alone gates them.
    await expect(guard.assertModuleEnabled('sales')).resolves.toBeUndefined();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('rejects an industry module with no subscription row', async () => {
    findFirst.mockResolvedValue(null);

    await expect(guard.assertModuleEnabled('clinic')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('rejects an industry module whose subscription has been disabled', async () => {
    // The other half of Section 6.2's condition: the row survives so billing
    // history is preserved, but disabledAt makes it inaccessible.
    findFirst.mockResolvedValue({ disabledAt: new Date() });

    await expect(guard.assertModuleEnabled('restaurant')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('queries by moduleKey alone and lets the extension inject tenantId', async () => {
    findFirst.mockResolvedValue({ disabledAt: null });

    await guard.assertModuleEnabled('pharmacy');

    // Passing tenantId here would be redundant at best; the point of the scoped
    // client is that the caller cannot choose the tenant.
    expect(findFirst).toHaveBeenCalledWith({
      where: { moduleKey: 'pharmacy' },
      select: { disabledAt: true },
    });
  });

  it('fails closed when no tenant context is bound', async () => {
    getTenantId.mockReturnValue(undefined);

    // Not a ForbiddenException: running out of order is a wiring bug, and it
    // should surface as a 500 with a log rather than look like a normal denial.
    // Checked before the core short-circuit, so it fires even for `sales`.
    await expect(guard.assertModuleEnabled('sales')).rejects.toThrow(
      /before the tenant context was bound/,
    );
    expect(findFirst).not.toHaveBeenCalled();
  });
});
