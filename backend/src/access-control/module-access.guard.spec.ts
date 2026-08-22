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

  it('allows a module with an enabled subscription', async () => {
    findFirst.mockResolvedValue({ disabledAt: null });

    await expect(guard.assertModuleEnabled('sales')).resolves.toBeUndefined();
  });

  it('rejects a module with no subscription row', async () => {
    findFirst.mockResolvedValue(null);

    await expect(guard.assertModuleEnabled('clinic')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('rejects a module whose subscription has been disabled', async () => {
    // The other half of Section 6.2's condition: the row survives so billing
    // history is preserved, but disabledAt makes it inaccessible.
    findFirst.mockResolvedValue({ disabledAt: new Date() });

    await expect(guard.assertModuleEnabled('reports')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('queries by moduleKey alone and lets the extension inject tenantId', async () => {
    findFirst.mockResolvedValue({ disabledAt: null });

    await guard.assertModuleEnabled('sales');

    // Passing tenantId here would be redundant at best; the point of the scoped
    // client is that the caller cannot choose the tenant.
    expect(findFirst).toHaveBeenCalledWith({
      where: { moduleKey: 'sales' },
      select: { disabledAt: true },
    });
  });

  it('fails closed when no tenant context is bound', async () => {
    getTenantId.mockReturnValue(undefined);

    // Not a ForbiddenException: running out of order is a wiring bug, and it
    // should surface as a 500 with a log rather than look like a normal denial.
    await expect(guard.assertModuleEnabled('sales')).rejects.toThrow(
      /before the tenant context was bound/,
    );
    expect(findFirst).not.toHaveBeenCalled();
  });
});
