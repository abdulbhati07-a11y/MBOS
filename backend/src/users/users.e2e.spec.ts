import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PasswordService } from '../auth/password.service';
import { PaginatedEnvelope } from '../common/dto/pagination.dto';
import { ApiExceptionFilter } from '../common/filters/http-exception.filter';
import { ApiValidationPipe } from '../common/pipes/api-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { RateLimitConfig } from '../rate-limit/rate-limit.config';
import { UserResponse } from './dto/user.dto';

/**
 * End-to-end coverage of Section 6.5's user-management endpoints.
 *
 * ISOLATION (C-05). Every user this suite touches carries the `.userstest@`
 * marker in its address, and cleanUp removes them along with their refresh
 * tokens. It never touches owner@dev.local, whose tokens the auth suite
 * manipulates.
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

const OWNER_EMAIL = 'owner.userstest@dev.local';
const MANAGER_EMAIL = 'manager.userstest@dev.local';
const TEST_PASSWORD = 'UsersTest0!';
/** Every address this suite creates contains this, so cleanup is exact. */
const MARKER = '.userstest@dev.local';
const CREATED_PASSWORD = 'CreatedUser1!';
const ABSENT_UUID = '00000000-0000-4000-8000-000000000000';

describe('Users (e2e)', () => {
  jest.setTimeout(90_000);

  let app: INestApplication;
  let prisma: PrismaService;
  let passwords: PasswordService;
  let ownerToken: string;
  let managerToken: string;
  let ownerUserId: string;
  let tenantId: string;
  let cashierRoleId: string;
  let managerRoleId: string;

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
    app.useGlobalPipes(new ApiValidationPipe());
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();

    prisma = app.get(PrismaService);
    passwords = app.get(PasswordService);

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
        throw new Error(`Built-in role ${roleName} missing. Re-run the seed.`);
      }
      const user = await prisma.user.create({
        data: { tenantId, email, passwordHash, roleId: role.id },
      });
      if (email === OWNER_EMAIL) ownerUserId = user.id;
    }

    cashierRoleId = await builtInId('Cashier');
    managerRoleId = await builtInId('Manager');

    ownerToken = await login(OWNER_EMAIL, TEST_PASSWORD);
    managerToken = await login(MANAGER_EMAIL, TEST_PASSWORD);
  }, 120_000);

  afterAll(async () => {
    await cleanUp();
    await app.close();
  }, 60_000);

  async function login(email: string, password: string): Promise<string> {
    const res = await post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    return bodyOf<TokenEnvelope>(res).accessToken;
  }

  async function builtInId(name: string): Promise<string> {
    const role = await prisma.role.findFirst({
      where: { tenantId: null, name },
      select: { id: true },
    });
    if (!role) throw new Error(`Built-in role ${name} missing.`);
    return role.id;
  }

  /** Removes every user this suite created, and their tokens (C-05). */
  async function cleanUp(): Promise<void> {
    const where = { user: { email: { contains: MARKER } } };
    await prisma.refreshToken.deleteMany({ where });
    await prisma.passwordResetToken.deleteMany({ where });
    await prisma.user.deleteMany({
      where: { tenantId, email: { contains: MARKER } },
    });
  }

  async function createUser(
    email: string,
    overrides: Record<string, unknown> = {},
  ): Promise<UserResponse> {
    const res = await post('/api/v1/users')
      .set(authed(ownerToken))
      .send({
        email,
        password: CREATED_PASSWORD,
        roleId: cashierRoleId,
        ...overrides,
      })
      .expect(201);
    return bodyOf<UserResponse>(res);
  }

  describe('GET /users', () => {
    it('lists users without exposing credentials', async () => {
      // pageSize=100 (the Section 6.1 maximum), not the default 10: every e2e
      // suite creates its own Owner/Manager/Cashier in this same tenant, and they
      // run concurrently, so the default page fills with other suites' fixtures
      // and this suite's own Owner falls off it. GET /users has no ?search= to
      // narrow by marker — Section 6.5 does not specify one — so the widest legal
      // page is the way to keep the row in view.
      const res = await get('/api/v1/users?pageSize=100')
        .set(authed(ownerToken))
        .expect(200);

      const body = bodyOf<PaginatedEnvelope<UserResponse>>(res);
      expect(body.pagination.total).toBeGreaterThanOrEqual(2);

      const owner = body.data.find((u) => u.email === OWNER_EMAIL);
      expect(owner?.roleName).toBe('Owner');
      // Credentials must never leave the server, even to an admin.
      for (const user of body.data) {
        expect(user).not.toHaveProperty('passwordHash');
        expect(user).not.toHaveProperty('mfaSecret');
      }
    });

    it('filters on ?isActive=false', async () => {
      const created = await createUser(`inactive${MARKER}`, {
        isActive: false,
      });

      const res = await get('/api/v1/users?isActive=false&pageSize=100')
        .set(authed(ownerToken))
        .expect(200);

      const { data } = bodyOf<PaginatedEnvelope<UserResponse>>(res);
      expect(data.find((u) => u.id === created.id)).toBeDefined();
      // The literal string 'false' must not be coerced to true.
      expect(data.every((u) => !u.isActive)).toBe(true);
    });

    it('answers 400 for a non-boolean isActive', async () => {
      await get('/api/v1/users?isActive=maybe')
        .set(authed(ownerToken))
        .expect(400);
    });

    it('is readable by a Manager but not anonymously', async () => {
      await get('/api/v1/users').set(authed(managerToken)).expect(200);
      await get('/api/v1/users').expect(401);
    });
  });

  describe('POST /users', () => {
    it('creates a user who can immediately log in', async () => {
      const created = await createUser(`newhire${MARKER}`);
      expect(created.roleName).toBe('Cashier');
      expect(created.isActive).toBe(true);

      // The real proof the password was hashed with the same implementation
      // login verifies against — not just that a row exists.
      const token = await login(`newhire${MARKER}`, CREATED_PASSWORD);
      expect(typeof token).toBe('string');

      const row = await prisma.user.findUnique({
        where: { id: created.id },
        select: { passwordHash: true },
      });
      expect(row?.passwordHash).not.toBe(CREATED_PASSWORD);
      expect(await passwords.verify(CREATED_PASSWORD, row?.passwordHash ?? '')).toBe(
        true,
      );
    });

    it('lowercases the email so addresses cannot collide by case', async () => {
      const created = await createUser(`MixedCase${MARKER}`);
      expect(created.email).toBe(`mixedcase${MARKER}`);
    });

    it.each([
      ['too short', 'Ab1!'],
      ['no uppercase', 'lowercase1!'],
      ['no lowercase', 'UPPERCASE1!'],
      ['no digit', 'NoDigitsHere!'],
      ['no special character', 'NoSpecials1'],
    ])('rejects a password with %s', async (_label, password) => {
      // Section 3.3.1 enforced server-side for the first time — until now the
      // policy lived only in the frontend's Zod schema.
      await post('/api/v1/users')
        .set(authed(ownerToken))
        .send({
          email: `weak${MARKER}`,
          password,
          roleId: cashierRoleId,
        })
        .expect(422);
    });

    it('rejects a duplicate email with 409', async () => {
      await createUser(`dupe${MARKER}`);
      await post('/api/v1/users')
        .set(authed(ownerToken))
        .send({
          email: `dupe${MARKER}`,
          password: CREATED_PASSWORD,
          roleId: cashierRoleId,
        })
        .expect(409);
    });

    it('rejects a roleId this tenant cannot use', async () => {
      // A client-supplied UUID could otherwise assign another tenant's custom
      // role, and PermissionGuard would then refuse every request that user made.
      const res = await post('/api/v1/users')
        .set(authed(ownerToken))
        .send({
          email: `badrole${MARKER}`,
          password: CREATED_PASSWORD,
          roleId: ABSENT_UUID,
        })
        .expect(422);
      expect(bodyOf<ErrorEnvelope>(res).error.message).toMatch(/not available/i);
    });

    it('refuses a Manager', async () => {
      await post('/api/v1/users')
        .set(authed(managerToken))
        .send({
          email: `managermade${MARKER}`,
          password: CREATED_PASSWORD,
          roleId: cashierRoleId,
        })
        .expect(403);
    });
  });

  describe('PATCH /users/:id', () => {
    it('reassigns a role', async () => {
      const created = await createUser(`promotable${MARKER}`);

      const res = await patch(`/api/v1/users/${created.id}`)
        .set(authed(ownerToken))
        .send({ roleId: managerRoleId })
        .expect(200);

      const body = bodyOf<UserResponse>(res);
      expect(body.roleId).toBe(managerRoleId);
      expect(body.roleName).toBe('Manager');
    });

    it('refuses to let the caller change their own role', async () => {
      // An Owner switching themselves to Cashier would lose settings.write and
      // could not undo it — a lockout delivered by a 200.
      const res = await patch(`/api/v1/users/${ownerUserId}`)
        .set(authed(ownerToken))
        .send({ roleId: cashierRoleId })
        .expect(403);
      expect(bodyOf<ErrorEnvelope>(res).error.message).toMatch(/your own role/i);
    });

    it('refuses to let the caller deactivate themselves', async () => {
      await patch(`/api/v1/users/${ownerUserId}`)
        .set(authed(ownerToken))
        .send({ isActive: false })
        .expect(403);
    });

    it('rejects an email another live user already holds', async () => {
      const first = await createUser(`clash1${MARKER}`);
      await createUser(`clash2${MARKER}`);

      await patch(`/api/v1/users/${first.id}`)
        .set(authed(ownerToken))
        .send({ email: `clash2${MARKER}` })
        .expect(409);
    });

    it('answers 404 for an absent id and 400 for a malformed one', async () => {
      await patch(`/api/v1/users/${ABSENT_UUID}`)
        .set(authed(ownerToken))
        .send({ isActive: false })
        .expect(404);
      await patch('/api/v1/users/not-a-uuid')
        .set(authed(ownerToken))
        .send({ isActive: false })
        .expect(400);
    });
  });

  describe('DELETE /users/:id', () => {
    it('soft-deletes and revokes outstanding refresh tokens', async () => {
      const created = await createUser(`leaver${MARKER}`);
      await login(`leaver${MARKER}`, CREATED_PASSWORD);

      const before = await prisma.refreshToken.count({
        where: { userId: created.id },
      });
      expect(before).toBeGreaterThan(0);

      await del(`/api/v1/users/${created.id}`)
        .set(authed(ownerToken))
        .expect(200);

      // Without this the account stays usable: the auth guard reads the token,
      // not the user row, so a live refresh token would keep minting access
      // tokens for a deleted user until it expired on its own.
      expect(
        await prisma.refreshToken.count({ where: { userId: created.id } }),
      ).toBe(0);

      const row = await prisma.user.findUnique({
        where: { id: created.id },
        select: { deletedAt: true, isActive: true },
      });
      expect(row?.deletedAt).toBeInstanceOf(Date);
      expect(row?.isActive).toBe(false);

      const list = await get('/api/v1/users?pageSize=100')
        .set(authed(ownerToken))
        .expect(200);
      expect(
        bodyOf<PaginatedEnvelope<UserResponse>>(list).data.find(
          (u) => u.id === created.id,
        ),
      ).toBeUndefined();
    });

    it('refuses to let the caller delete themselves', async () => {
      const res = await del(`/api/v1/users/${ownerUserId}`)
        .set(authed(ownerToken))
        .expect(403);
      expect(bodyOf<ErrorEnvelope>(res).error.message).toMatch(/your own/i);
    });

    it('frees the address, and the revived user does not keep the old password', async () => {
      const first = await createUser(`rehire${MARKER}`);
      await del(`/api/v1/users/${first.id}`)
        .set(authed(ownerToken))
        .expect(200);

      // @@unique([tenantId, email]) still counts the soft-deleted row, so this
      // would fail outright if create did not revive it.
      const revived = await post('/api/v1/users')
        .set(authed(ownerToken))
        .send({
          email: `rehire${MARKER}`,
          password: 'DifferentPass9!',
          roleId: managerRoleId,
        })
        .expect(201);

      expect(bodyOf<UserResponse>(revived).roleName).toBe('Manager');

      // The address is reused, so the previous holder's credentials must not be.
      await post('/api/v1/auth/login')
        .send({ email: `rehire${MARKER}`, password: CREATED_PASSWORD })
        .expect(401);
      await login(`rehire${MARKER}`, 'DifferentPass9!');
    });

    it('refuses a Manager, who lacks settings.delete', async () => {
      const created = await createUser(`managercannotdelete${MARKER}`);
      await del(`/api/v1/users/${created.id}`)
        .set(authed(managerToken))
        .expect(403);
    });
  });
});
