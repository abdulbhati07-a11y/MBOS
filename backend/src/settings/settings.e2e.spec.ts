import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PasswordService } from '../auth/password.service';
import { ApiExceptionFilter } from '../common/filters/http-exception.filter';
import { ApiValidationPipe } from '../common/pipes/api-validation.pipe';
import { PaginatedEnvelope, MAX_PAGE_SIZE } from '../common/dto/pagination.dto';
import { PrismaService } from '../prisma/prisma.service';
import { RateLimitConfig } from '../rate-limit/rate-limit.config';
import {
  BranchResponse,
  TenantSettingsResponse,
} from './dto/settings-response.dto';

/**
 * End-to-end coverage of Section 6.4 — settings and branches.
 *
 * ISOLATION (C-05). Jest runs spec files in parallel workers against one shared
 * dev database, and this suite is the first that mutates rows the *seed* creates
 * rather than only rows it made itself: `TenantSettings` is 1:1 with the tenant,
 * and promoting a branch necessarily demotes the seeded default. Both are
 * therefore snapshotted in beforeAll and restored in cleanUp, so the suite leaves
 * the tenant exactly as it found it and can re-run. Its own users and branches are
 * name-prefixed and removed outright.
 *
 * Requires `npm run db:seed` to have run against DATABASE_URL in backend/.env.
 */

interface ErrorEnvelope {
  error: { code: string; message: string };
}

interface TokenEnvelope {
  accessToken: string;
}

const bodyOf = <T>(res: { body: unknown }): T => res.body as T;

const OWNER_EMAIL = 'owner.settingstest@dev.local';
const MANAGER_EMAIL = 'manager.settingstest@dev.local';
const TEST_PASSWORD = 'SettingsTest0!';
/** Every branch this suite creates starts with this, so cleanup is exact. */
const BRANCH_PREFIX = 'ZZ Settings Test';
/** A syntactically valid UUID that will not exist — the 404 probe. */
const ABSENT_UUID = '00000000-0000-4000-8000-000000000000';

type SettingsSnapshot = {
  companyName: string;
  defaultTaxRateBps: number;
  currencyCode: string;
  timezone: string;
};

describe('Settings and Branches (e2e)', () => {
  jest.setTimeout(90_000);

  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let managerToken: string;
  let tenantId: string;
  let originalSettings: SettingsSnapshot | null = null;
  let originalDefaultBranchId: string | null = null;

  const get = (path: string) => request(app.getHttpServer() as never).get(path);
  const post = (path: string) =>
    request(app.getHttpServer() as never).post(path);
  const patch = (path: string) =>
    request(app.getHttpServer() as never).patch(path);
  const del = (path: string) =>
    request(app.getHttpServer() as never).delete(path);

  const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
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
    // The same pipe main.ts installs, so the 400-vs-422 split under test is the
    // production behaviour rather than something this suite configures.
    app.useGlobalPipes(new ApiValidationPipe());
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();

    prisma = app.get(PrismaService);
    const passwords = app.get(PasswordService);

    const tenant = await prisma.tenant.findUnique({ where: { slug: 'dev' } });
    if (!tenant) {
      throw new Error('Dev tenant is missing. Run `npm run db:seed` first.');
    }
    tenantId = tenant.id;

    // Snapshot BEFORE cleanUp, because cleanUp restores from these.
    const settingsRow = await prisma.tenantSettings.findUnique({
      where: { tenantId },
      select: {
        companyName: true,
        defaultTaxRateBps: true,
        currencyCode: true,
        timezone: true,
      },
    });
    originalSettings = settingsRow;

    const defaultBranch = await prisma.branch.findFirst({
      where: { tenantId, isDefault: true },
      select: { id: true },
    });
    originalDefaultBranchId = defaultBranch?.id ?? null;

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

  /**
   * Removes this suite's users and branches, and puts the seeded settings and
   * default branch back (C-05).
   */
  async function cleanUp(): Promise<void> {
    const emails = [OWNER_EMAIL, MANAGER_EMAIL];
    await prisma.refreshToken.deleteMany({
      where: { user: { email: { in: emails } } },
    });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });

    await prisma.branch.deleteMany({
      where: { tenantId, name: { startsWith: BRANCH_PREFIX } },
    });

    // Demote first, promote second. The partial unique index allows one
    // isDefault row per tenant, so promoting before demoting would collide.
    if (originalDefaultBranchId) {
      await prisma.branch.updateMany({
        where: { tenantId, isDefault: true, id: { not: originalDefaultBranchId } },
        data: { isDefault: false },
      });
      await prisma.branch.update({
        where: { id: originalDefaultBranchId },
        data: { isDefault: true },
      });
    }

    if (originalSettings) {
      await prisma.tenantSettings.update({
        where: { tenantId },
        data: originalSettings,
      });
    }
  }

  /** Creates a branch through the API and returns it. */
  async function createBranch(
    name: string,
    extra: Record<string, unknown> = {},
  ): Promise<BranchResponse> {
    const res = await post('/api/v1/branches')
      .set(authed(ownerToken))
      .send({ name, ...extra })
      .expect(201);
    return bodyOf<BranchResponse>(res);
  }

  describe('GET /settings', () => {
    it('returns the tenant settings with the tax rate in basis points', async () => {
      const res = await get('/api/v1/settings')
        .set(authed(ownerToken))
        .expect(200);

      const body = bodyOf<TenantSettingsResponse>(res);
      expect(typeof body.companyName).toBe('string');
      expect(typeof body.currencyCode).toBe('string');
      expect(typeof body.timezone).toBe('string');
      // Basis points, so an integer — never a float percentage (NFR-14).
      expect(Number.isInteger(body.defaultTaxRateBps)).toBe(true);
    });

    it('is readable by a Manager, who holds settings.read but not write', async () => {
      await get('/api/v1/settings').set(authed(managerToken)).expect(200);
    });

    it('rejects an unauthenticated request', async () => {
      await get('/api/v1/settings').expect(401);
    });
  });

  describe('PATCH /settings', () => {
    it('applies a partial update and echoes the stored values', async () => {
      const res = await patch('/api/v1/settings')
        .set(authed(ownerToken))
        .send({ companyName: 'Renamed By Test', defaultTaxRateBps: 875 })
        .expect(200);

      const body = bodyOf<TenantSettingsResponse>(res);
      expect(body.companyName).toBe('Renamed By Test');
      expect(body.defaultTaxRateBps).toBe(875);

      // Partial: currencyCode was not sent, so it must be untouched.
      expect(body.currencyCode).toBe(originalSettings?.currencyCode ?? 'PKR');
    });

    it('refuses a Manager (settings.write is Owner-only)', async () => {
      await patch('/api/v1/settings')
        .set(authed(managerToken))
        .send({ companyName: 'Manager Should Not Manage This' })
        .expect(403);
    });

    it('rejects a fractional tax rate — bps must be an integer', async () => {
      await patch('/api/v1/settings')
        .set(authed(ownerToken))
        .send({ defaultTaxRateBps: 8.5 })
        .expect(422);
    });

    it('rejects a tax rate above 100%', async () => {
      await patch('/api/v1/settings')
        .set(authed(ownerToken))
        .send({ defaultTaxRateBps: 10_001 })
        .expect(422);
    });

    it('rejects a currency code that is not ISO 4217', async () => {
      // A currency *name* rather than its code. This is the realistic mistake now
      // that the frontend has a currency field at all, and it must not be stored:
      // every money column is minor units of this value.
      await patch('/api/v1/settings')
        .set(authed(ownerToken))
        .send({ currencyCode: 'Rupees' })
        .expect(422);
    });

    it('rejects a currency symbol', async () => {
      // The schema says "never store the display symbol", and CompanyProfileForm
      // used to hold exactly that. Rs is two letters, not three, so the shape
      // check catches it.
      await patch('/api/v1/settings')
        .set(authed(ownerToken))
        .send({ currencyCode: 'Rs' })
        .expect(422);
    });

    it('refuses to let a client smuggle in tenantId', async () => {
      // forbidNonWhitelisted: tenant context comes from the JWT only, and a body
      // that tries to override it must fail loudly rather than be dropped.
      await patch('/api/v1/settings')
        .set(authed(ownerToken))
        .send({ tenantId: '11111111-1111-4111-8111-111111111111' })
        .expect(422);
    });
  });

  describe('GET /branches', () => {
    it('returns the Section 6.1 pagination envelope', async () => {
      const res = await get('/api/v1/branches')
        .set(authed(ownerToken))
        .expect(200);

      const body = bodyOf<PaginatedEnvelope<BranchResponse>>(res);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.pagination.pageIndex).toBe(0);
      expect(body.pagination.pageSize).toBe(10);
      expect(body.pagination.total).toBeGreaterThanOrEqual(1);
      // The seeded default branch must be present and listed first.
      expect(body.data[0]?.isDefault).toBe(true);
    });

    it('honours pageIndex and pageSize', async () => {
      const res = await get('/api/v1/branches?pageIndex=0&pageSize=1')
        .set(authed(ownerToken))
        .expect(200);

      const body = bodyOf<PaginatedEnvelope<BranchResponse>>(res);
      expect(body.data).toHaveLength(1);
      expect(body.pagination.pageSize).toBe(1);
    });

    it(`answers 400 — not 422 — when pageSize exceeds ${MAX_PAGE_SIZE}`, async () => {
      // Section 6.1 assigns 400 to a bad query parameter and 422 to a bad body.
      // The global pipe is configured for 422, so this asserts the dedicated
      // query pipe is actually wired up.
      await get(`/api/v1/branches?pageSize=${MAX_PAGE_SIZE + 1}`)
        .set(authed(ownerToken))
        .expect(400);
    });

    it('answers 400 for a non-numeric pageIndex', async () => {
      await get('/api/v1/branches?pageIndex=abc')
        .set(authed(ownerToken))
        .expect(400);
    });
  });

  describe('POST /branches', () => {
    it('creates a branch with 201', async () => {
      const branch = await createBranch(`${BRANCH_PREFIX} A`, {
        address: '1 Test Street',
      });

      expect(branch.name).toBe(`${BRANCH_PREFIX} A`);
      expect(branch.address).toBe('1 Test Street');
      expect(branch.isDefault).toBe(false);
      expect(branch.isActive).toBe(true);
      expect(branch.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('refuses a Manager', async () => {
      await post('/api/v1/branches')
        .set(authed(managerToken))
        .send({ name: `${BRANCH_PREFIX} Manager` })
        .expect(403);
    });

    it('rejects a branch with no name', async () => {
      await post('/api/v1/branches')
        .set(authed(ownerToken))
        .send({ address: 'nameless' })
        .expect(422);
    });
  });

  describe('PATCH /branches/:id', () => {
    it('updates a branch', async () => {
      const branch = await createBranch(`${BRANCH_PREFIX} Renamable`);

      const res = await patch(`/api/v1/branches/${branch.id}`)
        .set(authed(ownerToken))
        .send({ address: '2 Changed Road', isActive: false })
        .expect(200);

      const body = bodyOf<BranchResponse>(res);
      expect(body.address).toBe('2 Changed Road');
      expect(body.isActive).toBe(false);
      expect(body.name).toBe(`${BRANCH_PREFIX} Renamable`);
    });

    it('promotes a branch to default and demotes the incumbent atomically', async () => {
      const branch = await createBranch(`${BRANCH_PREFIX} Promotable`);

      const res = await patch(`/api/v1/branches/${branch.id}`)
        .set(authed(ownerToken))
        .send({ isDefault: true })
        .expect(200);
      expect(bodyOf<BranchResponse>(res).isDefault).toBe(true);

      // Exactly one default must survive the promote — the partial unique index
      // guarantees the database agrees, this asserts the API left it consistent.
      const defaults = await prisma.branch.findMany({
        where: { tenantId, isDefault: true, deletedAt: null },
        select: { id: true },
      });
      expect(defaults).toHaveLength(1);
      expect(defaults[0]?.id).toBe(branch.id);

      // Restore the seeded default through the same path, proving the demote
      // works in both directions and leaving the tenant as found.
      if (originalDefaultBranchId) {
        await patch(`/api/v1/branches/${originalDefaultBranchId}`)
          .set(authed(ownerToken))
          .send({ isDefault: true })
          .expect(200);
      }
    });

    it('refuses to un-default the default branch, which would leave none', async () => {
      // Not in Section 6.4's letter; it follows from FR-TEN-02 (every tenant has
      // a default branch). Promoting a replacement is the supported path.
      if (!originalDefaultBranchId) return;

      const res = await patch(`/api/v1/branches/${originalDefaultBranchId}`)
        .set(authed(ownerToken))
        .send({ isDefault: false })
        .expect(409);

      expect(bodyOf<ErrorEnvelope>(res).error.message).toMatch(/default/i);
    });

    it('answers 404 for a well-formed id that does not exist', async () => {
      await patch(`/api/v1/branches/${ABSENT_UUID}`)
        .set(authed(ownerToken))
        .send({ address: 'nowhere' })
        .expect(404);
    });

    it('answers 400 for a malformed id', async () => {
      await patch('/api/v1/branches/not-a-uuid')
        .set(authed(ownerToken))
        .send({ address: 'nowhere' })
        .expect(400);
    });
  });

  describe('DELETE /branches/:id', () => {
    it('soft-deletes a branch with no financial history', async () => {
      const branch = await createBranch(`${BRANCH_PREFIX} Deletable`);

      await del(`/api/v1/branches/${branch.id}`)
        .set(authed(ownerToken))
        .expect(200);

      // Gone from the API...
      const list = await get('/api/v1/branches?pageSize=100')
        .set(authed(ownerToken))
        .expect(200);
      const { data } = bodyOf<PaginatedEnvelope<BranchResponse>>(list);
      expect(data.find((b) => b.id === branch.id)).toBeUndefined();

      // ...but still on disk with deletedAt stamped. Soft delete, per Section
      // 5.1: a branch an Order might later reference must not vanish.
      const row = await prisma.branch.findUnique({
        where: { id: branch.id },
        select: { deletedAt: true },
      });
      expect(row?.deletedAt).toBeInstanceOf(Date);
    });

    it('refuses to delete the default branch', async () => {
      if (!originalDefaultBranchId) return;

      const res = await del(`/api/v1/branches/${originalDefaultBranchId}`)
        .set(authed(ownerToken))
        .expect(409);

      expect(bodyOf<ErrorEnvelope>(res).error.message).toMatch(/default/i);
    });

    it('refuses a Manager, who lacks settings.delete', async () => {
      const branch = await createBranch(`${BRANCH_PREFIX} ManagerCannotDelete`);

      await del(`/api/v1/branches/${branch.id}`)
        .set(authed(managerToken))
        .expect(403);
    });

    it('answers 404 for an already-deleted branch', async () => {
      const branch = await createBranch(`${BRANCH_PREFIX} DeleteTwice`);

      await del(`/api/v1/branches/${branch.id}`)
        .set(authed(ownerToken))
        .expect(200);
      // The second delete must not find it — reads filter deletedAt explicitly,
      // since the tenant-scope extension does not append that filter.
      await del(`/api/v1/branches/${branch.id}`)
        .set(authed(ownerToken))
        .expect(404);
    });
  });
});
