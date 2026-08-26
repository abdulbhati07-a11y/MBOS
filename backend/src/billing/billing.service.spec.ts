import { ConflictException, NotFoundException } from '@nestjs/common';
import { INDUSTRY_MODULE_KEYS } from '../access-control/access-control.constants';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from './billing.service';

/**
 * Unit coverage for Section 6.10's logic. Prisma is stubbed, so the branches
 * that are awkward to reach end-to-end — a tenant with no subscription, a
 * previously-disabled row being re-enabled — are exercised directly.
 */
describe('BillingService', () => {
  let subscriptionFindMany: jest.Mock;
  let subscriptionFindFirst: jest.Mock;
  let subscriptionUpdate: jest.Mock;
  let subscriptionCreate: jest.Mock;
  let tenantSubscriptionFindFirst: jest.Mock;
  let planFindMany: jest.Mock;
  let service: BillingService;

  beforeEach(() => {
    subscriptionFindMany = jest.fn().mockResolvedValue([]);
    subscriptionFindFirst = jest.fn().mockResolvedValue(null);
    subscriptionUpdate = jest.fn().mockResolvedValue({});
    subscriptionCreate = jest.fn().mockResolvedValue({});
    tenantSubscriptionFindFirst = jest.fn().mockResolvedValue(null);
    planFindMany = jest.fn().mockResolvedValue([]);

    const prisma = {
      db: {
        tenantModuleSubscription: {
          findMany: subscriptionFindMany,
          findFirst: subscriptionFindFirst,
          update: subscriptionUpdate,
          create: subscriptionCreate,
        },
        tenantSubscription: { findFirst: tenantSubscriptionFindFirst },
      },
      plan: { findMany: planFindMany },
    } as unknown as PrismaService;

    service = new BillingService(prisma);
  });

  describe('listModules', () => {
    it('reports every industry module, including ones with no row', async () => {
      subscriptionFindMany.mockResolvedValue([
        { moduleKey: 'pharmacy', enabledAt: new Date(), disabledAt: null },
      ]);

      const result = await service.listModules();

      // Only industry modules are subscribable (DEBT-016); each must appear even
      // with no row, reported as disabled. Core modules (e.g. sales) are never
      // listed here at all.
      expect(result).toHaveLength(INDUSTRY_MODULE_KEYS.length);
      expect(result.find((m) => m.moduleKey === 'pharmacy')?.enabled).toBe(
        true,
      );
      expect(result.find((m) => m.moduleKey === 'clinic')?.enabled).toBe(false);
      expect(
        result.find((m) => m.moduleKey === 'clinic')?.enabledAt,
      ).toBeUndefined();
      // A core module is not a subscribable module and must be absent entirely.
      expect(result.find((m) => m.moduleKey === 'sales')).toBeUndefined();
    });

    it('treats a row with disabledAt set as disabled', async () => {
      const disabledAt = new Date('2026-06-01T00:00:00.000Z');
      subscriptionFindMany.mockResolvedValue([
        { moduleKey: 'clinic', enabledAt: new Date(), disabledAt },
      ]);

      const clinic = (await service.listModules()).find(
        (m) => m.moduleKey === 'clinic',
      );

      expect(clinic?.enabled).toBe(false);
      expect(clinic?.disabledAt).toBe(disabledAt.toISOString());
    });
  });

  describe('getSubscription', () => {
    it('returns 404 when the tenant has no billing record', async () => {
      await expect(service.getSubscription()).rejects.toThrow(
        NotFoundException,
      );
    });

    it('maps the plan and period onto the Section 6.10 shape', async () => {
      tenantSubscriptionFindFirst.mockResolvedValue({
        status: 'Active',
        currentPeriodStart: new Date('2026-08-01T00:00:00.000Z'),
        currentPeriodEnd: new Date('2026-08-31T23:59:59.000Z'),
        plan: { name: 'Growth', priceMonthly: 1_299_900 },
      });

      await expect(service.getSubscription()).resolves.toEqual({
        plan: { name: 'Growth', priceMonthly: 1_299_900 },
        status: 'Active',
        currentPeriodStart: '2026-08-01T00:00:00.000Z',
        currentPeriodEnd: '2026-08-31T23:59:59.000Z',
      });
    });
  });

  describe('listPlans', () => {
    it('flattens each plan module list to its keys', async () => {
      planFindMany.mockResolvedValue([
        {
          id: 'plan-1',
          name: 'Starter',
          priceMonthly: 499_900,
          modules: [{ moduleKey: 'sales' }, { moduleKey: 'inventory' }],
        },
      ]);

      await expect(service.listPlans()).resolves.toEqual([
        {
          id: 'plan-1',
          name: 'Starter',
          priceMonthly: 499_900,
          modules: ['sales', 'inventory'],
        },
      ]);
    });
  });

  describe('updateModule', () => {
    it('previews without writing when confirmed is absent', async () => {
      const result = await service.updateModule({
        moduleKey: 'clinic',
        enabled: true,
      });

      expect(result.committed).toBe(false);
      expect(result.proratedChargeCents).toBeNull();
      expect(result.message).toContain('confirmed');
      // The point of the two-step flow: nothing reached the database.
      expect(subscriptionCreate).not.toHaveBeenCalled();
      expect(subscriptionUpdate).not.toHaveBeenCalled();
    });

    it('creates a row when confirming an enable for a never-subscribed module', async () => {
      const result = await service.updateModule({
        moduleKey: 'clinic',
        enabled: true,
        confirmed: true,
      });

      expect(result.committed).toBe(true);
      // No tenantId passed — the scoped client's extension supplies it.
      expect(subscriptionCreate).toHaveBeenCalledWith({
        data: { moduleKey: 'clinic' },
      });
    });

    it('clears disabledAt when re-enabling a previously disabled module', async () => {
      subscriptionFindFirst.mockResolvedValue({
        id: 'row-1',
        disabledAt: new Date('2026-06-01T00:00:00.000Z'),
      });

      await service.updateModule({
        moduleKey: 'clinic',
        enabled: true,
        confirmed: true,
      });

      expect(subscriptionUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'row-1' },
          data: expect.objectContaining({ disabledAt: null }),
        }),
      );
    });

    it('stamps disabledAt rather than deleting the row when disabling', async () => {
      subscriptionFindFirst.mockResolvedValue({
        id: 'row-1',
        disabledAt: null,
      });

      await service.updateModule({
        moduleKey: 'clinic',
        enabled: false,
        confirmed: true,
      });

      const args = subscriptionUpdate.mock.calls[0][0] as {
        data: { disabledAt: Date | null };
      };
      // History must survive: Section 5.3 disables by timestamp, never by delete.
      expect(args.data.disabledAt).toBeInstanceOf(Date);
    });

    it('treats a no-op as already committed and never asks for confirmation', async () => {
      subscriptionFindFirst.mockResolvedValue({
        id: 'row-1',
        disabledAt: null,
      });

      const result = await service.updateModule({
        moduleKey: 'pharmacy',
        enabled: true,
      });

      // Nothing changes, so there is nothing to bill and nothing to confirm.
      expect(result.committed).toBe(true);
      expect(result.message).toContain('already enabled');
      expect(subscriptionUpdate).not.toHaveBeenCalled();
    });

    it('refuses to disable a core module (RBAC-only, never subscribed)', async () => {
      // Core modules never carry a subscription row (DEBT-016), so there is
      // nothing to cancel. The rejection is 409 and fires before any DB read.
      for (const moduleKey of ['settings', 'dashboard', 'billing'] as const) {
        await expect(
          service.updateModule({ moduleKey, enabled: false, confirmed: true }),
        ).rejects.toThrow(ConflictException);
      }
      expect(subscriptionFindFirst).not.toHaveBeenCalled();
      expect(subscriptionUpdate).not.toHaveBeenCalled();
    });

    it('refuses to enable a core module (it is always available already)', async () => {
      // The inverse of the above: enabling a core module would write the one row
      // the system must never hold. Both directions are a 409 (DEBT-016).
      for (const moduleKey of ['sales', 'reports', 'inventory'] as const) {
        await expect(
          service.updateModule({ moduleKey, enabled: true, confirmed: true }),
        ).rejects.toThrow(ConflictException);
      }
      expect(subscriptionCreate).not.toHaveBeenCalled();
      expect(subscriptionUpdate).not.toHaveBeenCalled();
    });

    it('echoes a supplied effectiveDate and defaults it otherwise', async () => {
      const supplied = await service.updateModule({
        moduleKey: 'clinic',
        enabled: true,
        effectiveDate: '2026-09-01',
      });
      expect(supplied.effectiveDate).toBe('2026-09-01');

      const defaulted = await service.updateModule({
        moduleKey: 'clinic',
        enabled: true,
      });
      expect(defaulted.effectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});
