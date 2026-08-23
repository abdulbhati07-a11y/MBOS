import {
  Controller,
  Get,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { RequiresPermission } from '../access-control/access-control.decorators';
import { INDUSTRY_MODULE_KEYS } from '../access-control/access-control.constants';
import { AppModule } from '../app.module';
import { PasswordService } from '../auth/password.service';
import { ApiExceptionFilter } from '../common/filters/http-exception.filter';
import { PrismaService } from '../prisma/prisma.service';
import { RateLimitConfig } from '../rate-limit/rate-limit.config';
import {
  ListEnvelope,
  ModuleStatus,
  ModuleToggleResult,
  PlanSummary,
  SubscriptionSummary,
} from './dto/billing-response.dto';

/**
 * End-to-end coverage of Section 6.10, including the UC-04 round trip: a module
 * is unreachable, gets enabled through the API, and becomes reachable on the very
 * next request with no restart.
 *
 * ISOLATION. Jest runs spec files in parallel workers against the same dev
 * database, so this suite deliberately shares nothing with the others: it
 * creates its own two users (never touching owner@dev.local, whose refresh
 * tokens the auth suite manipulates) and toggles `pharmacy`, while
 * access-control.e2e.spec.ts asserts on `clinic`. Both start unsubscribed, so
 * neither suite can disturb the other's expectations.
 *
 * Requires `npm run db:seed` to have run against the DATABASE_URL in backend/.env.
 */
@Controller('test-billing')
class TestPharmacyController {
  /** Gated on a module the dev tenant does not start with — the UC-04 probe. */
  @RequiresPermission('pharmacy', 'read')
  @Get('pharmacy')
  pharmacy(): { ok: true } {
    return { ok: true };
  }
}

interface ErrorEnvelope {
  error: { code: string; message: string };
}

interface TokenEnvelope {
  accessToken: string;
}

const bodyOf = <T>(res: { body: unknown }): T => res.body as T;

const OWNER_EMAIL = 'owner.billingtest@dev.local';
const MANAGER_EMAIL = 'manager.billingtest@dev.local';
const TEST_PASSWORD = 'BillingTest0!';
/** Toggled by this suite only; removed entirely in afterAll. */
const TOGGLED_MODULE = 'pharmacy';

describe('Billing (e2e)', () => {
  jest.setTimeout(90_000);

  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let managerToken: string;
  let tenantId: string;

  const get = (path: string) => request(app.getHttpServer() as never).get(path);
  const post = (path: string) =>
    request(app.getHttpServer() as never).post(path);
  const patch = (path: string) =>
    request(app.getHttpServer() as never).patch(path);

  const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [TestPharmacyController],
    })
      .overrideProvider(RateLimitConfig)
      .useValue({
        enabled: false,
        authIpLimit: 0,
        globalIpLimit: 0,
        tenantLimit: 0,
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        errorHttpStatusCode: 422,
      }),
    );
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();

    prisma = app.get(PrismaService);
    const passwords = app.get(PasswordService);

    const tenant = await prisma.tenant.findUnique({ where: { slug: 'dev' } });
    if (!tenant) {
      throw new Error('Dev tenant is missing. Run `npm run db:seed` first.');
    }
    tenantId = tenant.id;

    await cleanUp();

    const passwordHash = await passwords.hash(TEST_PASSWORD);
    for (const [email, roleName] of [
      [OWNER_EMAIL, 'Owner'],
      [MANAGER_EMAIL, 'Manager'],
    ] as const) {
      const role = await prisma.role.findFirst({
        where: { tenantId: null, name: roleName },
      });
      if (!role) {
        throw new Error(
          `Built-in role ${roleName} is missing. Re-run the seed.`,
        );
      }
      await prisma.user.create({
        data: { tenantId, email, passwordHash, roleId: role.id },
      });
    }

    ownerToken = await login(OWNER_EMAIL);
    managerToken = await login(MANAGER_EMAIL);
  }, 120_000);

  afterAll(async () => {
    await cleanUp();
    await app.close();
  }, 60_000);

  async function login(email: string): Promise<string> {
    const res = await post('/api/v1/auth/login')
      .send({ email, password: TEST_PASSWORD })
      .expect(200);
    return bodyOf<TokenEnvelope>(res).accessToken;
  }

  /** Removes this suite's users and its subscription row (C-05). */
  async function cleanUp(): Promise<void> {
    const emails = [OWNER_EMAIL, MANAGER_EMAIL];
    await prisma.refreshToken.deleteMany({
      where: { user: { email: { in: emails } } },
    });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    // Deleted rather than disabled, so the module returns to the pristine
    // never-subscribed state the seed leaves it in and the suite can re-run.
    await prisma.tenantModuleSubscription.deleteMany({
      where: { tenantId, moduleKey: TOGGLED_MODULE },
    });
  }

  describe('GET /billing/modules', () => {
    it('lists every industry module with its subscription status', async () => {
      const res = await get('/api/v1/billing/modules')
        .set(authed(ownerToken))
        .expect(200);

      const { data } = bodyOf<ListEnvelope<ModuleStatus>>(res);
      // Only industry modules are subscribable (DEBT-016); core modules such as
      // `sales` are RBAC-only and must not appear in this list at all.
      expect(data).toHaveLength(INDUSTRY_MODULE_KEYS.length);
      expect(data.find((m) => m.moduleKey === 'sales')).toBeUndefined();

      // Never subscribed: reported as disabled with no timestamps at all.
      expect(data.find((m) => m.moduleKey === TOGGLED_MODULE)).toEqual({
        moduleKey: TOGGLED_MODULE,
        enabled: false,
      });
    });

    it('is readable with settings.read, so a Manager may view it', async () => {
      await get('/api/v1/billing/modules')
        .set(authed(managerToken))
        .expect(200);
    });

    it('requires authentication', async () => {
      await get('/api/v1/billing/modules').expect(401);
    });
  });

  describe('GET /billing/subscription', () => {
    it('returns the seeded plan and period', async () => {
      const res = await get('/api/v1/billing/subscription')
        .set(authed(ownerToken))
        .expect(200);

      expect(bodyOf<SubscriptionSummary>(res)).toEqual({
        plan: { name: 'Growth', priceMonthly: 4900 },
        status: 'Active',
        currentPeriodStart: expect.any(String),
        currentPeriodEnd: expect.any(String),
      });
    });
  });

  describe('GET /plans', () => {
    it('returns the catalogue with each plan module list', async () => {
      const res = await get('/api/v1/plans')
        .set(authed(ownerToken))
        .expect(200);

      const { data } = bodyOf<ListEnvelope<PlanSummary>>(res);
      const names = data.map((plan) => plan.name);
      expect(names).toEqual(expect.arrayContaining(['Starter', 'Growth']));

      const starter = data.find((plan) => plan.name === 'Starter');
      expect(starter?.priceMonthly).toBe(1900);
      expect(starter?.modules).toEqual(
        expect.arrayContaining(['dashboard', 'sales']),
      );
    });
  });

  describe('PATCH /billing/modules', () => {
    it('refuses a Manager, who has settings.read but not settings.write', async () => {
      const res = await patch('/api/v1/billing/modules')
        .set(authed(managerToken))
        .send({ moduleKey: TOGGLED_MODULE, enabled: true, confirmed: true })
        .expect(403);
      expect(bodyOf<ErrorEnvelope>(res).error.code).toBe('FORBIDDEN');
    });

    it('rejects an unknown module key', async () => {
      await patch('/api/v1/billing/modules')
        .set(authed(ownerToken))
        .send({ moduleKey: 'not-a-module', enabled: true })
        .expect(422);
    });

    it('rejects a body trying to smuggle in a tenantId', async () => {
      // Tenant context comes only from the JWT (Section 4.3).
      await patch('/api/v1/billing/modules')
        .set(authed(ownerToken))
        .send({ moduleKey: TOGGLED_MODULE, enabled: true, tenantId: 'forged' })
        .expect(422);
    });

    it('refuses to toggle a core module, which is never subscription-gated', async () => {
      // `settings` is a core module (DEBT-016): always available, never carries a
      // subscription row, so there is nothing to enable or disable. 409, and it
      // fires before any write.
      const res = await patch('/api/v1/billing/modules')
        .set(authed(ownerToken))
        .send({ moduleKey: 'settings', enabled: false, confirmed: true })
        .expect(409);
      expect(bodyOf<ErrorEnvelope>(res).error.code).toBe('CONFLICT');
    });

    it('previews without committing when confirmed is absent', async () => {
      const res = await patch('/api/v1/billing/modules')
        .set(authed(ownerToken))
        .send({ moduleKey: TOGGLED_MODULE, enabled: true })
        .expect(200);

      const preview = bodyOf<ModuleToggleResult>(res);
      expect(preview.committed).toBe(false);
      // Section 6.10 wants a prorated charge here; it is not computable yet
      // (DEBT-018), and null is reported rather than a fabricated number.
      expect(preview.proratedChargeCents).toBeNull();

      // The module must still be off — that is the whole point of the gate.
      const after = await get('/api/v1/billing/modules')
        .set(authed(ownerToken))
        .expect(200);
      expect(
        bodyOf<ListEnvelope<ModuleStatus>>(after).data.find(
          (m) => m.moduleKey === TOGGLED_MODULE,
        )?.enabled,
      ).toBe(false);
    });

    it('enables a module that takes effect on the next request (UC-04)', async () => {
      // Before: the module-access guard refuses, even for an Owner who holds
      // pharmacy.read in the canonical matrix.
      await get('/api/v1/test-billing/pharmacy')
        .set(authed(ownerToken))
        .expect(403);

      const res = await patch('/api/v1/billing/modules')
        .set(authed(ownerToken))
        .send({ moduleKey: TOGGLED_MODULE, enabled: true, confirmed: true })
        .expect(200);
      expect(bodyOf<ModuleToggleResult>(res).committed).toBe(true);

      // After: reachable immediately, on the same running process — no restart,
      // no redeployment, no new token. This is UC-04 end to end.
      await get('/api/v1/test-billing/pharmacy')
        .set(authed(ownerToken))
        .expect(200);
    });

    it('treats re-enabling an enabled module as a committed no-op', async () => {
      const res = await patch('/api/v1/billing/modules')
        .set(authed(ownerToken))
        .send({ moduleKey: TOGGLED_MODULE, enabled: true })
        .expect(200);

      const result = bodyOf<ModuleToggleResult>(res);
      expect(result.committed).toBe(true);
      expect(result.message).toContain('already enabled');
    });

    it('disables the module again and revokes access immediately', async () => {
      await patch('/api/v1/billing/modules')
        .set(authed(ownerToken))
        .send({ moduleKey: TOGGLED_MODULE, enabled: false, confirmed: true })
        .expect(200);

      await get('/api/v1/test-billing/pharmacy')
        .set(authed(ownerToken))
        .expect(403);

      // Disabling stamps disabledAt; the row survives so billing history does.
      const row = await prisma.tenantModuleSubscription.findFirst({
        where: { tenantId, moduleKey: TOGGLED_MODULE },
      });
      expect(row?.disabledAt).toBeInstanceOf(Date);
    });
  });
});
