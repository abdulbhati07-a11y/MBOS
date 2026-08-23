import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { PERMISSION_GRID } from '../access-control/access-control.constants';
import { AppModule } from '../app.module';
import { PasswordService } from '../auth/password.service';
import { PaginatedEnvelope } from '../common/dto/pagination.dto';
import { ApiExceptionFilter } from '../common/filters/http-exception.filter';
import { ApiValidationPipe } from '../common/pipes/api-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { RateLimitConfig } from '../rate-limit/rate-limit.config';
import { PermissionEntry, RoleResponse } from './dto/role.dto';

/**
 * End-to-end coverage of Section 6.5's role endpoints.
 *
 * ISOLATION (C-05). Creates its own users and its own custom roles, all name- or
 * email-prefixed, and removes them in cleanUp. It never mutates a built-in role:
 * those are global (`tenantId = null`, D-02) and shared by every tenant, so a
 * write to one would corrupt every other suite's expectations — several of the
 * assertions below exist precisely to prove the API refuses such writes.
 *
 * Requires `npm run db:seed` to have run against DATABASE_URL in backend/.env.
 */

interface ErrorEnvelope {
  error: { code: string; message: string };
}

interface TokenEnvelope {
  accessToken: string;
}

interface ListEnvelope<T> {
  data: T[];
}

const bodyOf = <T>(res: { body: unknown }): T => res.body as T;

const OWNER_EMAIL = 'owner.rolestest@dev.local';
const MANAGER_EMAIL = 'manager.rolestest@dev.local';
const HOLDER_EMAIL = 'holder.rolestest@dev.local';
const TEST_PASSWORD = 'RolesTest0!';
const ROLE_PREFIX = 'ZZ Roles Test';
const ABSENT_UUID = '00000000-0000-4000-8000-000000000000';

describe('Roles (e2e)', () => {
  jest.setTimeout(90_000);

  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let managerToken: string;
  let tenantId: string;

  const get = (path: string) => request(app.getHttpServer() as never).get(path);
  const post = (path: string) =>
    request(app.getHttpServer() as never).post(path);
  const put = (path: string) => request(app.getHttpServer() as never).put(path);
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
   * Removes this suite's users and custom roles (C-05).
   *
   * Users first: `User.roleId` is a hard foreign key, so a role still held cannot
   * be hard-deleted. Built-ins are protected by the `tenantId` filter — a
   * `deleteMany` without it would match nothing here, but stating it makes the
   * intent unmistakable.
   */
  async function cleanUp(): Promise<void> {
    const emails = [OWNER_EMAIL, MANAGER_EMAIL, HOLDER_EMAIL];
    await prisma.refreshToken.deleteMany({
      where: { user: { email: { in: emails } } },
    });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.rolePermission.deleteMany({
      where: { role: { tenantId, name: { startsWith: ROLE_PREFIX } } },
    });
    await prisma.role.deleteMany({
      where: { tenantId, name: { startsWith: ROLE_PREFIX } },
    });
  }

  async function createRole(name: string): Promise<RoleResponse> {
    const res = await post('/api/v1/roles')
      .set(authed(ownerToken))
      .send({ name })
      .expect(201);
    return bodyOf<RoleResponse>(res);
  }

  async function builtInId(name: string): Promise<string> {
    const role = await prisma.role.findFirst({
      where: { tenantId: null, name },
      select: { id: true },
    });
    if (!role) throw new Error(`Built-in role ${name} missing.`);
    return role.id;
  }

  describe('GET /roles', () => {
    it('returns the three built-ins in the pagination envelope', async () => {
      const res = await get('/api/v1/roles')
        .set(authed(ownerToken))
        .expect(200);

      const body = bodyOf<PaginatedEnvelope<RoleResponse>>(res);
      const names = body.data.map((role) => role.name);
      expect(names).toContain('Owner');
      expect(names).toContain('Manager');
      expect(names).toContain('Cashier');
      // Built-ins sort first, so the first row must be one of them.
      expect(body.data[0]?.isBuiltIn).toBe(true);
      expect(body.pagination.total).toBeGreaterThanOrEqual(3);
    });

    it('is readable by a Manager', async () => {
      await get('/api/v1/roles').set(authed(managerToken)).expect(200);
    });

    it('rejects an unauthenticated request', async () => {
      await get('/api/v1/roles').expect(401);
    });
  });

  describe('POST /roles', () => {
    it('creates a custom role', async () => {
      const role = await createRole(`${ROLE_PREFIX} Supervisor`);
      expect(role.name).toBe(`${ROLE_PREFIX} Supervisor`);
      expect(role.isBuiltIn).toBe(false);

      // Tenant-scoped, not global — a custom role must never become a built-in.
      const row = await prisma.role.findUnique({
        where: { id: role.id },
        select: { tenantId: true, isBuiltIn: true },
      });
      expect(row?.tenantId).toBe(tenantId);
      expect(row?.isBuiltIn).toBe(false);
    });

    it('rejects a duplicate name with 409', async () => {
      await createRole(`${ROLE_PREFIX} Duplicate`);
      await post('/api/v1/roles')
        .set(authed(ownerToken))
        .send({ name: `${ROLE_PREFIX} Duplicate` })
        .expect(409);
    });

    it('refuses to shadow a built-in name', async () => {
      // The unique index would allow it — built-ins have tenantId null, so the
      // (tenantId, name) pair differs — which is exactly why this is checked.
      const res = await post('/api/v1/roles')
        .set(authed(ownerToken))
        .send({ name: 'Owner' })
        .expect(409);
      expect(bodyOf<ErrorEnvelope>(res).error.message).toMatch(/built-in/i);
    });

    it('refuses a Manager', async () => {
      await post('/api/v1/roles')
        .set(authed(managerToken))
        .send({ name: `${ROLE_PREFIX} ManagerMade` })
        .expect(403);
    });

    it('rejects an attempt to set isBuiltIn', async () => {
      await post('/api/v1/roles')
        .set(authed(ownerToken))
        .send({ name: `${ROLE_PREFIX} Sneaky`, isBuiltIn: true })
        .expect(422);
    });

    it('rejects an empty name', async () => {
      await post('/api/v1/roles')
        .set(authed(ownerToken))
        .send({ name: '' })
        .expect(422);
    });
  });

  describe('DELETE /roles/:id', () => {
    it('refuses to delete a built-in role with 403', async () => {
      const res = await del(`/api/v1/roles/${await builtInId('Cashier')}`)
        .set(authed(ownerToken))
        .expect(403);
      expect(bodyOf<ErrorEnvelope>(res).error.message).toMatch(/built-in/i);
    });

    it('soft-deletes an unheld custom role', async () => {
      const role = await createRole(`${ROLE_PREFIX} Deletable`);

      await del(`/api/v1/roles/${role.id}`)
        .set(authed(ownerToken))
        .expect(200);

      const list = await get('/api/v1/roles?pageSize=100')
        .set(authed(ownerToken))
        .expect(200);
      const { data } = bodyOf<PaginatedEnvelope<RoleResponse>>(list);
      expect(data.find((r) => r.id === role.id)).toBeUndefined();

      const row = await prisma.role.findUnique({
        where: { id: role.id },
        select: { deletedAt: true },
      });
      expect(row?.deletedAt).toBeInstanceOf(Date);
    });

    it('refuses with 409 while a user still holds the role', async () => {
      const role = await createRole(`${ROLE_PREFIX} Held`);
      const passwords = app.get(PasswordService);
      await prisma.user.create({
        data: {
          tenantId,
          email: HOLDER_EMAIL,
          passwordHash: await passwords.hash(TEST_PASSWORD),
          roleId: role.id,
        },
      });

      const res = await del(`/api/v1/roles/${role.id}`)
        .set(authed(ownerToken))
        .expect(409);
      expect(bodyOf<ErrorEnvelope>(res).error.message).toMatch(/still hold/i);

      await prisma.user.deleteMany({ where: { email: HOLDER_EMAIL } });
    });

    it('frees the name for reuse, and the revived role starts with no permissions', async () => {
      const first = await createRole(`${ROLE_PREFIX} Recycled`);
      await put(`/api/v1/roles/${first.id}/permissions`)
        .set(authed(ownerToken))
        .send({ permissions: [{ module: 'sales', action: 'read', granted: true }] })
        .expect(200);
      await del(`/api/v1/roles/${first.id}`)
        .set(authed(ownerToken))
        .expect(200);

      // The unique index still counts the soft-deleted row, so this would fail
      // outright if create did not revive it.
      const second = await createRole(`${ROLE_PREFIX} Recycled`);

      const res = await get(`/api/v1/roles/${second.id}/permissions`)
        .set(authed(ownerToken))
        .expect(200);
      const granted = bodyOf<ListEnvelope<PermissionEntry>>(res).data.filter(
        (entry) => entry.granted,
      );
      // Critical: the id is reused, so any stale token carrying it must not
      // regain the old grants.
      expect(granted).toHaveLength(0);
    });

    it('answers 404 for an absent id and 400 for a malformed one', async () => {
      await del(`/api/v1/roles/${ABSENT_UUID}`)
        .set(authed(ownerToken))
        .expect(404);
      await del('/api/v1/roles/not-a-uuid')
        .set(authed(ownerToken))
        .expect(400);
    });
  });

  describe('GET /roles/:id/permissions', () => {
    it('returns the complete grid, including denials', async () => {
      const res = await get(`/api/v1/roles/${await builtInId('Cashier')}/permissions`)
        .set(authed(ownerToken))
        .expect(200);

      const { data } = bodyOf<ListEnvelope<PermissionEntry>>(res);
      expect(data).toHaveLength(PERMISSION_GRID.length);

      // Cashier's canonical matrix (Section 3.2): sales read+write, no refund,
      // no purchases at all.
      const cell = (module: string, action: string) =>
        data.find((e) => e.module === module && e.action === action)?.granted;
      expect(cell('sales', 'read')).toBe(true);
      expect(cell('sales', 'write')).toBe(true);
      expect(cell('sales', 'refund')).toBe(false);
      expect(cell('purchases', 'read')).toBe(false);
    });

    it('scopes refund to sales only', async () => {
      const res = await get(`/api/v1/roles/${await builtInId('Owner')}/permissions`)
        .set(authed(ownerToken))
        .expect(200);

      const { data } = bodyOf<ListEnvelope<PermissionEntry>>(res);
      // BR-03: refund is a reversing sales transaction. It is not a permission
      // other modules have denied — it does not exist for them.
      const refundModules = data
        .filter((e) => e.action === 'refund')
        .map((e) => e.module);
      expect(refundModules).toEqual(['sales']);
      expect(
        data.find((e) => e.module === 'sales' && e.action === 'refund')?.granted,
      ).toBe(true);
    });

    it('answers 404 for a role this tenant cannot see', async () => {
      await get(`/api/v1/roles/${ABSENT_UUID}/permissions`)
        .set(authed(ownerToken))
        .expect(404);
    });
  });

  describe('PUT /roles/:id/permissions', () => {
    it('refuses to modify a built-in role with 403', async () => {
      const res = await put(`/api/v1/roles/${await builtInId('Manager')}/permissions`)
        .set(authed(ownerToken))
        .send({ permissions: [{ module: 'sales', action: 'read', granted: true }] })
        .expect(403);
      expect(bodyOf<ErrorEnvelope>(res).error.message).toMatch(/built-in/i);

      // And the canonical matrix is untouched — Manager still reads reports.
      const check = await get(`/api/v1/roles/${await builtInId('Manager')}/permissions`)
        .set(authed(ownerToken))
        .expect(200);
      expect(
        bodyOf<ListEnvelope<PermissionEntry>>(check).data.find(
          (e) => e.module === 'reports' && e.action === 'read',
        )?.granted,
      ).toBe(true);
    });

    it('replaces the whole set, revoking anything omitted', async () => {
      const role = await createRole(`${ROLE_PREFIX} Replaceable`);

      await put(`/api/v1/roles/${role.id}/permissions`)
        .set(authed(ownerToken))
        .send({
          permissions: [
            { module: 'sales', action: 'read', granted: true },
            { module: 'sales', action: 'write', granted: true },
            { module: 'inventory', action: 'read', granted: true },
          ],
        })
        .expect(200);

      const second = await put(`/api/v1/roles/${role.id}/permissions`)
        .set(authed(ownerToken))
        .send({
          permissions: [{ module: 'sales', action: 'read', granted: true }],
        })
        .expect(200);

      const granted = bodyOf<ListEnvelope<PermissionEntry>>(second)
        .data.filter((e) => e.granted)
        .map((e) => `${e.module}.${e.action}`);
      // PUT is a replace: the two omitted grants are gone, not merged.
      expect(granted).toEqual(['sales.read']);
    });

    it('stores no row for a granted:false entry', async () => {
      const role = await createRole(`${ROLE_PREFIX} Denials`);

      await put(`/api/v1/roles/${role.id}/permissions`)
        .set(authed(ownerToken))
        .send({
          permissions: [
            { module: 'sales', action: 'read', granted: true },
            { module: 'sales', action: 'write', granted: false },
          ],
        })
        .expect(200);

      // Absence is denial — the convention the seed uses and the only thing
      // PermissionGuard queries. An explicit false row would be a second,
      // unread way of saying the same thing.
      const rows = await prisma.rolePermission.findMany({
        where: { roleId: role.id },
        select: { module: true, action: true, granted: true },
      });
      expect(rows).toEqual([
        { module: 'sales', action: 'read', granted: true },
      ]);
    });

    it('rejects refund on a module other than sales', async () => {
      const role = await createRole(`${ROLE_PREFIX} BadRefund`);
      await put(`/api/v1/roles/${role.id}/permissions`)
        .set(authed(ownerToken))
        .send({
          permissions: [
            { module: 'inventory', action: 'refund', granted: true },
          ],
        })
        .expect(422);
    });

    it('rejects a duplicated (module, action) pair', async () => {
      const role = await createRole(`${ROLE_PREFIX} Dupes`);
      await put(`/api/v1/roles/${role.id}/permissions`)
        .set(authed(ownerToken))
        .send({
          permissions: [
            { module: 'sales', action: 'read', granted: true },
            { module: 'sales', action: 'read', granted: false },
          ],
        })
        .expect(422);
    });

    it('rejects an unknown module', async () => {
      const role = await createRole(`${ROLE_PREFIX} BadModule`);
      await put(`/api/v1/roles/${role.id}/permissions`)
        .set(authed(ownerToken))
        .send({
          permissions: [{ module: 'telepathy', action: 'read', granted: true }],
        })
        .expect(422);
    });

    it('refuses a Manager', async () => {
      const role = await createRole(`${ROLE_PREFIX} ManagerWrite`);
      await put(`/api/v1/roles/${role.id}/permissions`)
        .set(authed(managerToken))
        .send({
          permissions: [{ module: 'sales', action: 'read', granted: true }],
        })
        .expect(403);
    });
  });
});
