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
import { CustomerDetailResponse, CustomerResponse } from './dto/customer.dto';

/**
 * End-to-end coverage of Section 6.6's customer endpoints.
 *
 * ISOLATION (C-05). Every customer and user this suite creates carries
 * `.custtest@` in its email, and cleanUp removes exactly those. List assertions
 * use `toBeGreaterThanOrEqual` and per-row predicates rather than exact totals,
 * because the suites run concurrently against the one dev database and another
 * suite's rows may be present.
 *
 * Requires `npm run db:seed`.
 */

interface ErrorEnvelope {
  error: { code: string; message: string };
}

interface TokenEnvelope {
  accessToken: string;
}

const bodyOf = <T>(res: { body: unknown }): T => res.body as T;

const MARKER = '.custtest@dev.local';
const OWNER_EMAIL = `owner${MARKER}`;
const MANAGER_EMAIL = `manager${MARKER}`;
const CASHIER_EMAIL = `cashier${MARKER}`;
const TEST_PASSWORD = 'CustTest0!';
const ABSENT_UUID = '00000000-0000-4000-8000-000000000000';

describe('Customers (e2e)', () => {
  jest.setTimeout(90_000);

  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let ownerToken: string;
  let managerToken: string;
  let cashierToken: string;

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

    const tenant = await prisma.tenant.findUnique({ where: { slug: 'dev' } });
    if (!tenant) {
      throw new Error('Dev tenant is missing. Run `npm run db:seed` first.');
    }
    tenantId = tenant.id;

    await cleanUp();

    const passwordHash = await app.get(PasswordService).hash(TEST_PASSWORD);
    for (const [email, roleName] of [
      [OWNER_EMAIL, 'Owner'],
      [MANAGER_EMAIL, 'Manager'],
      [CASHIER_EMAIL, 'Cashier'],
    ] as const) {
      const role = await prisma.role.findFirst({
        where: { tenantId: null, name: roleName },
      });
      if (!role) {
        throw new Error(`Built-in role ${roleName} missing. Re-run the seed.`);
      }
      await prisma.user.create({
        data: { tenantId, email, passwordHash, roleId: role.id },
      });
    }

    ownerToken = await login(OWNER_EMAIL);
    managerToken = await login(MANAGER_EMAIL);
    cashierToken = await login(CASHIER_EMAIL);
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

  async function cleanUp(): Promise<void> {
    await prisma.refreshToken.deleteMany({
      where: { user: { email: { contains: MARKER } } },
    });
    await prisma.user.deleteMany({
      where: { tenantId, email: { contains: MARKER } },
    });
    await prisma.customer.deleteMany({
      where: { tenantId, email: { contains: MARKER } },
    });
  }

  async function createCustomer(
    email: string,
    overrides: Record<string, unknown> = {},
  ): Promise<CustomerResponse> {
    const res = await post('/api/v1/customers')
      .set(authed(ownerToken))
      .send({ name: 'Test Customer', email, ...overrides })
      .expect(201);
    return bodyOf<CustomerResponse>(res);
  }

  describe('GET /customers', () => {
    it('returns the Section 6.1 pagination envelope', async () => {
      await createCustomer(`listed${MARKER}`);

      const res = await get('/api/v1/customers?pageSize=100')
        .set(authed(ownerToken))
        .expect(200);

      const body = bodyOf<PaginatedEnvelope<CustomerResponse>>(res);
      expect(body.pagination.pageIndex).toBe(0);
      expect(body.pagination.pageSize).toBe(100);
      expect(body.pagination.total).toBeGreaterThanOrEqual(1);
      expect(body.data.some((c) => c.email === `listed${MARKER}`)).toBe(true);
    });

    it('matches ?search= against name and email, case-insensitively', async () => {
      const byName = await createCustomer(`searchname${MARKER}`, {
        name: 'Zenobia Wallingford',
      });
      const byEmail = await createCustomer(`zzsearchemail${MARKER}`);

      const nameHit = await get('/api/v1/customers?search=wallingFORD')
        .set(authed(ownerToken))
        .expect(200);
      expect(
        bodyOf<PaginatedEnvelope<CustomerResponse>>(nameHit).data.map(
          (c) => c.id,
        ),
      ).toContain(byName.id);

      const emailHit = await get('/api/v1/customers?search=ZZSEARCHEMAIL')
        .set(authed(ownerToken))
        .expect(200);
      expect(
        bodyOf<PaginatedEnvelope<CustomerResponse>>(emailHit).data.map(
          (c) => c.id,
        ),
      ).toContain(byEmail.id);
    });

    it('treats a blank ?search= as no filter, not as "matches nothing"', async () => {
      await createCustomer(`blanksearch${MARKER}`);

      const res = await get('/api/v1/customers?search=%20&pageSize=100')
        .set(authed(ownerToken))
        .expect(200);
      expect(
        bodyOf<PaginatedEnvelope<CustomerResponse>>(res).pagination.total,
      ).toBeGreaterThanOrEqual(1);
    });

    it('filters ?isActive=false without coercing the string to true', async () => {
      const inactive = await createCustomer(`inactive${MARKER}`, {
        isActive: false,
      });

      const res = await get('/api/v1/customers?isActive=false&pageSize=100')
        .set(authed(ownerToken))
        .expect(200);

      const { data } = bodyOf<PaginatedEnvelope<CustomerResponse>>(res);
      expect(data.map((c) => c.id)).toContain(inactive.id);
      expect(data.every((c) => !c.isActive)).toBe(true);
    });

    it('answers 400 for a bad query param and 401 anonymously', async () => {
      await get('/api/v1/customers?isActive=perhaps')
        .set(authed(ownerToken))
        .expect(400);
      await get('/api/v1/customers?pageSize=101')
        .set(authed(ownerToken))
        .expect(400);
      await get('/api/v1/customers').expect(401);
    });

    it('is readable by a Cashier', async () => {
      await get('/api/v1/customers').set(authed(cashierToken)).expect(200);
    });
  });

  describe('POST /customers', () => {
    it('lowercases the email and defaults the optional text columns', async () => {
      const created = await createCustomer(`MixedCase${MARKER}`);
      expect(created.email).toBe(`mixedcase${MARKER}`);
      expect(created.phone).toBe('');
      expect(created.address).toBe('');
      expect(created.notes).toBe('');
      expect(created.isActive).toBe(true);
    });

    it('rejects a duplicate email with 409', async () => {
      await createCustomer(`dupe${MARKER}`);
      await post('/api/v1/customers')
        .set(authed(ownerToken))
        .send({ name: 'Second', email: `dupe${MARKER}` })
        .expect(409);
    });

    it.each([
      ['a one-character name', { name: 'A', email: `short${MARKER}` }],
      ['a malformed email', { name: 'Valid Name', email: 'not-an-email' }],
      ['an unknown field', { name: 'Valid Name', email: `x${MARKER}`, xy: 1 }],
    ])('answers 422 for %s', async (_label, body) => {
      await post('/api/v1/customers')
        .set(authed(ownerToken))
        .send(body)
        .expect(422);
    });

    it('refuses a Cashier, who has customers.read only', async () => {
      await post('/api/v1/customers')
        .set(authed(cashierToken))
        .send({ name: 'Cashier Made', email: `cashiermade${MARKER}` })
        .expect(403);
    });
  });

  describe('GET /customers/:id', () => {
    it('returns detail with a paginated order history', async () => {
      const created = await createCustomer(`detail${MARKER}`);

      const res = await get(`/api/v1/customers/${created.id}`)
        .set(authed(ownerToken))
        .expect(200);

      const body = bodyOf<CustomerDetailResponse>(res);
      expect(body.id).toBe(created.id);
      // A new customer has no orders, and an empty history is 0 pages — not 1.
      expect(body.orders.data).toEqual([]);
      expect(body.orders.pagination.total).toBe(0);
      expect(body.orders.pagination.pageCount).toBe(0);
    });

    it('answers 404 for an absent id and 400 for a malformed one', async () => {
      await get(`/api/v1/customers/${ABSENT_UUID}`)
        .set(authed(ownerToken))
        .expect(404);
      await get('/api/v1/customers/not-a-uuid')
        .set(authed(ownerToken))
        .expect(400);
    });
  });

  describe('PATCH /customers/:id', () => {
    it('leaves omitted fields alone', async () => {
      const created = await createCustomer(`partial${MARKER}`, {
        phone: '555-0100',
        notes: 'Keep me',
      });

      const res = await patch(`/api/v1/customers/${created.id}`)
        .set(authed(ownerToken))
        .send({ name: 'Renamed Only' })
        .expect(200);

      const body = bodyOf<CustomerResponse>(res);
      expect(body.name).toBe('Renamed Only');
      // The bug this guards: building the update from the whole DTO would blank
      // every field the caller did not send, which is a PUT, not a PATCH.
      expect(body.phone).toBe('555-0100');
      expect(body.notes).toBe('Keep me');
    });

    it('rejects an email another live customer holds', async () => {
      const first = await createCustomer(`clash1${MARKER}`);
      await createCustomer(`clash2${MARKER}`);

      await patch(`/api/v1/customers/${first.id}`)
        .set(authed(ownerToken))
        .send({ email: `clash2${MARKER}` })
        .expect(409);
    });

    it('is allowed for a Manager', async () => {
      const created = await createCustomer(`managerpatch${MARKER}`);
      await patch(`/api/v1/customers/${created.id}`)
        .set(authed(managerToken))
        .send({ notes: 'Manager may write' })
        .expect(200);
    });
  });

  describe('DELETE /customers/:id', () => {
    it('soft-deletes and drops the row from the list', async () => {
      const created = await createCustomer(`leaver${MARKER}`);

      await del(`/api/v1/customers/${created.id}`)
        .set(authed(ownerToken))
        .expect(200);

      const row = await prisma.customer.findUnique({
        where: { id: created.id },
        select: { deletedAt: true, isActive: true },
      });
      expect(row?.deletedAt).toBeInstanceOf(Date);
      expect(row?.isActive).toBe(false);

      const list = await get('/api/v1/customers?pageSize=100')
        .set(authed(ownerToken))
        .expect(200);
      expect(
        bodyOf<PaginatedEnvelope<CustomerResponse>>(list).data.map((c) => c.id),
      ).not.toContain(created.id);

      await get(`/api/v1/customers/${created.id}`)
        .set(authed(ownerToken))
        .expect(404);
    });

    it('frees the email, and the revived customer keeps their history', async () => {
      const first = await createCustomer(`rehire${MARKER}`, {
        notes: 'Original note',
      });
      await del(`/api/v1/customers/${first.id}`)
        .set(authed(ownerToken))
        .expect(200);

      // @@unique([tenantId, email]) still counts the soft-deleted row, so this
      // would fail outright if create did not revive it.
      const revived = await createCustomer(`rehire${MARKER}`, {
        notes: 'New note',
      });

      // Same row, so order history — which hangs off customerId — survives. For a
      // customer the email IS the identity, unlike a user address that can be
      // reassigned, which is why this differs from UsersService.create.
      expect(revived.id).toBe(first.id);
      expect(revived.notes).toBe('New note');
      expect(revived.isActive).toBe(true);
    });

    it('refuses a Manager, who lacks customers.delete', async () => {
      const created = await createCustomer(`managercannot${MARKER}`);
      const res = await del(`/api/v1/customers/${created.id}`)
        .set(authed(managerToken))
        .expect(403);
      expect(bodyOf<ErrorEnvelope>(res).error.code).toBeDefined();
    });
  });
});
