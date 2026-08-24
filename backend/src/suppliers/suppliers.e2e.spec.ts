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
import {
  SupplierDetailResponse,
  SupplierResponse,
} from './dto/supplier.dto';

/**
 * End-to-end coverage of Section 6.6's supplier endpoints.
 *
 * ISOLATION (C-05). Everything created here carries `.supptest@` in its email and
 * is removed by cleanUp.
 *
 * Requires `npm run db:seed`.
 */

interface TokenEnvelope {
  accessToken: string;
}

const bodyOf = <T>(res: { body: unknown }): T => res.body as T;

const MARKER = '.supptest@dev.local';
const OWNER_EMAIL = `owner${MARKER}`;
const MANAGER_EMAIL = `manager${MARKER}`;
const CASHIER_EMAIL = `cashier${MARKER}`;
const TEST_PASSWORD = 'SuppTest0!';
const ABSENT_UUID = '00000000-0000-4000-8000-000000000000';

describe('Suppliers (e2e)', () => {
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
    await prisma.supplier.deleteMany({
      where: { tenantId, email: { contains: MARKER } },
    });
  }

  async function createSupplier(
    email: string,
    overrides: Record<string, unknown> = {},
  ): Promise<SupplierResponse> {
    const res = await post('/api/v1/suppliers')
      .set(authed(ownerToken))
      .send({
        name: 'Test Supplies Ltd',
        contactPerson: 'Dana Reyes',
        email,
        ...overrides,
      })
      .expect(201);
    return bodyOf<SupplierResponse>(res);
  }

  describe('GET /suppliers', () => {
    it('lists with the pagination envelope and matches ?search=', async () => {
      const created = await createSupplier(`searchable${MARKER}`, {
        name: 'Quartermaine Wholesale',
      });

      const res = await get('/api/v1/suppliers?search=QUARTERMAINE')
        .set(authed(ownerToken))
        .expect(200);

      const body = bodyOf<PaginatedEnvelope<SupplierResponse>>(res);
      expect(body.data.map((s) => s.id)).toContain(created.id);
      expect(body.pagination.pageSize).toBe(10);
    });

    it('filters ?isActive=false', async () => {
      const inactive = await createSupplier(`inactive${MARKER}`, {
        isActive: false,
      });

      const res = await get('/api/v1/suppliers?isActive=false&pageSize=100')
        .set(authed(ownerToken))
        .expect(200);

      const { data } = bodyOf<PaginatedEnvelope<SupplierResponse>>(res);
      expect(data.map((s) => s.id)).toContain(inactive.id);
      expect(data.every((s) => !s.isActive)).toBe(true);
    });

    it('answers 400 for a bad query param and 401 anonymously', async () => {
      await get('/api/v1/suppliers?isActive=perhaps')
        .set(authed(ownerToken))
        .expect(400);
      await get('/api/v1/suppliers').expect(401);
    });

    /**
     * The consequence of gating suppliers on `purchases` rather than an invented
     * `suppliers` module: a Cashier has no `purchases` grant at all, so unlike
     * customers and products this list is closed to them entirely. Asserted
     * explicitly so the decision is visible rather than incidental.
     */
    it('is closed to a Cashier, who has no purchases grant', async () => {
      await get('/api/v1/suppliers').set(authed(cashierToken)).expect(403);
    });
  });

  describe('POST /suppliers', () => {
    it('creates with defaults and lowercases the email', async () => {
      const created = await createSupplier(`MixedCase${MARKER}`);
      expect(created.email).toBe(`mixedcase${MARKER}`);
      expect(created.contactPerson).toBe('Dana Reyes');
      expect(created.categories).toBe('');
      expect(created.isActive).toBe(true);
    });

    /**
     * `contactPerson` is required by the Zod schema but the column defaults to
     * `""`. Section 6.6 says the body mirrors the schema, so the API is the
     * stricter of the two.
     */
    it('requires contactPerson even though the column defaults to empty', async () => {
      await post('/api/v1/suppliers')
        .set(authed(ownerToken))
        .send({ name: 'No Contact Ltd', email: `nocontact${MARKER}` })
        .expect(422);
    });

    it('rejects a duplicate email with 409', async () => {
      await createSupplier(`dupe${MARKER}`);
      await post('/api/v1/suppliers')
        .set(authed(ownerToken))
        .send({
          name: 'Second Ltd',
          contactPerson: 'Someone Else',
          email: `dupe${MARKER}`,
        })
        .expect(409);
    });

    it('is allowed for a Manager but refused for a Cashier', async () => {
      await post('/api/v1/suppliers')
        .set(authed(managerToken))
        .send({
          name: 'Manager Made Ltd',
          contactPerson: 'Manager Contact',
          email: `managermade${MARKER}`,
        })
        .expect(201);

      await post('/api/v1/suppliers')
        .set(authed(cashierToken))
        .send({
          name: 'Cashier Made Ltd',
          contactPerson: 'Cashier Contact',
          email: `cashiermade${MARKER}`,
        })
        .expect(403);
    });
  });

  describe('GET /suppliers/:id', () => {
    it('returns detail with a paginated PO history', async () => {
      const created = await createSupplier(`detail${MARKER}`);

      const res = await get(`/api/v1/suppliers/${created.id}`)
        .set(authed(ownerToken))
        .expect(200);

      const body = bodyOf<SupplierDetailResponse>(res);
      expect(body.id).toBe(created.id);
      expect(body.purchaseOrders.data).toEqual([]);
      expect(body.purchaseOrders.pagination.total).toBe(0);
    });

    it('answers 404 for an absent id and 400 for a malformed one', async () => {
      await get(`/api/v1/suppliers/${ABSENT_UUID}`)
        .set(authed(ownerToken))
        .expect(404);
      await get('/api/v1/suppliers/not-a-uuid')
        .set(authed(ownerToken))
        .expect(400);
    });
  });

  describe('PATCH /suppliers/:id', () => {
    it('leaves omitted fields alone', async () => {
      const created = await createSupplier(`partial${MARKER}`, {
        categories: 'stationery,packaging',
      });

      const res = await patch(`/api/v1/suppliers/${created.id}`)
        .set(authed(ownerToken))
        .send({ contactPerson: 'New Contact' })
        .expect(200);

      const body = bodyOf<SupplierResponse>(res);
      expect(body.contactPerson).toBe('New Contact');
      expect(body.categories).toBe('stationery,packaging');
      expect(body.name).toBe('Test Supplies Ltd');
    });

    it('rejects an email another live supplier holds', async () => {
      const first = await createSupplier(`clash1${MARKER}`);
      await createSupplier(`clash2${MARKER}`);

      await patch(`/api/v1/suppliers/${first.id}`)
        .set(authed(ownerToken))
        .send({ email: `clash2${MARKER}` })
        .expect(409);
    });
  });

  describe('DELETE /suppliers/:id', () => {
    it('soft-deletes and drops the row from the list', async () => {
      const created = await createSupplier(`leaver${MARKER}`);

      await del(`/api/v1/suppliers/${created.id}`)
        .set(authed(ownerToken))
        .expect(200);

      const row = await prisma.supplier.findUnique({
        where: { id: created.id },
        select: { deletedAt: true, isActive: true },
      });
      expect(row?.deletedAt).toBeInstanceOf(Date);
      expect(row?.isActive).toBe(false);

      await get(`/api/v1/suppliers/${created.id}`)
        .set(authed(ownerToken))
        .expect(404);
    });

    it('frees the email for a revive', async () => {
      const first = await createSupplier(`rehire${MARKER}`);
      await del(`/api/v1/suppliers/${first.id}`)
        .set(authed(ownerToken))
        .expect(200);

      const revived = await createSupplier(`rehire${MARKER}`, {
        name: 'Returned Supplies Ltd',
      });
      expect(revived.id).toBe(first.id);
      expect(revived.name).toBe('Returned Supplies Ltd');
      expect(revived.isActive).toBe(true);
    });

    it('refuses a Manager, who lacks purchases.delete', async () => {
      const created = await createSupplier(`managercannot${MARKER}`);
      await del(`/api/v1/suppliers/${created.id}`)
        .set(authed(managerToken))
        .expect(403);
    });
  });
});
