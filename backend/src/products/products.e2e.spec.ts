import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PasswordService } from '../auth/password.service';
import { PaginatedEnvelope } from '../common/dto/pagination.dto';
import { ApiExceptionFilter } from '../common/filters/http-exception.filter';
import { ApiValidationPipe } from '../common/pipes/api-validation.pipe';
import { MAX_MONEY_MINOR } from '../common/validation/money';
import { PrismaService } from '../prisma/prisma.service';
import { RateLimitConfig } from '../rate-limit/rate-limit.config';
import { ProductResponse } from './dto/product.dto';

/**
 * End-to-end coverage of Section 6.6's product endpoints.
 *
 * The money assertions are the point of this suite. `MOCK_PRODUCTS` in
 * `src/lib/mock-data/products.ts` stores `price: 29.99` while the column is
 * `priceCents Int` (DEBT-012), so the frontend swap will send floats unless
 * something stops it. These tests are what stop it: a float is a 422 naming the
 * field, never a row that is 100x wrong in a column BR-03 later freezes.
 *
 * ISOLATION (C-05). Products carry `-PRODTEST` in their SKU, users carry
 * `.prodtest@` in their email, and the order fixture carries `PRODTEST-` in its
 * order number. cleanUp removes exactly those.
 *
 * Requires `npm run db:seed`.
 */

interface ErrorEnvelope {
  error: { code: string; message: string; details?: unknown };
}

interface TokenEnvelope {
  accessToken: string;
}

const bodyOf = <T>(res: { body: unknown }): T => res.body as T;

const SKU_MARKER = '-PRODTEST';
const USER_MARKER = '.prodtest@dev.local';
const ORDER_MARKER = 'PRODTEST-';
const OWNER_EMAIL = `owner${USER_MARKER}`;
const MANAGER_EMAIL = `manager${USER_MARKER}`;
const CASHIER_EMAIL = `cashier${USER_MARKER}`;
const TEST_PASSWORD = 'ProdTest0!';
/** Unique to this suite so ?category= cannot pick up another suite's rows. */
const TEST_CATEGORY = 'ProdTestCategory';
const ABSENT_UUID = '00000000-0000-4000-8000-000000000000';

describe('Products (e2e)', () => {
  jest.setTimeout(90_000);

  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let branchId: string;
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

    const branch = await prisma.branch.findFirst({ where: { tenantId } });
    if (!branch) {
      throw new Error('Dev tenant has no branch. Re-run the seed.');
    }
    branchId = branch.id;

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
    // Orders first: OrderLine cascades from Order, and a line holds the FK that
    // would otherwise block the product delete below.
    await prisma.order.deleteMany({
      where: { tenantId, orderNumber: { startsWith: ORDER_MARKER } },
    });
    await prisma.pOLine.deleteMany({
      where: { product: { sku: { contains: SKU_MARKER } } },
    });
    await prisma.product.deleteMany({
      where: { tenantId, sku: { contains: SKU_MARKER } },
    });
    await prisma.refreshToken.deleteMany({
      where: { user: { email: { contains: USER_MARKER } } },
    });
    await prisma.user.deleteMany({
      where: { tenantId, email: { contains: USER_MARKER } },
    });
  }

  /** Valid body: cents, never floats. */
  function validBody(sku: string, overrides: Record<string, unknown> = {}) {
    return {
      name: 'Test Widget',
      sku,
      category: TEST_CATEGORY,
      priceCents: 2999,
      costCents: 1200,
      uom: 'piece',
      reorderPoint: 10,
      ...overrides,
    };
  }

  async function createProduct(
    sku: string,
    overrides: Record<string, unknown> = {},
  ): Promise<ProductResponse> {
    const res = await post('/api/v1/products')
      .set(authed(ownerToken))
      .send(validBody(sku, overrides))
      .expect(201);
    return bodyOf<ProductResponse>(res);
  }

  describe('money is cents on the wire (DEBT-012)', () => {
    /**
     * The headline test. `29.99` is exactly what `MOCK_PRODUCTS` holds and exactly
     * what a frontend that forgot to convert would send. Truncating it to `29`
     * would understate the price by 99%, and BR-03 forbids editing the order rows
     * it would go on to produce — so the only acceptable answer is a refusal that
     * names the field.
     */
    it.each([
      ['priceCents', 29.99],
      ['costCents', 12.5],
    ])('rejects a float %s with 422', async (field, value) => {
      const res = await post('/api/v1/products')
        .set(authed(ownerToken))
        .send(validBody(`FLOAT${field}${SKU_MARKER}`, { [field]: value }))
        .expect(422);

      expect(bodyOf<ErrorEnvelope>(res).error.details).toBeDefined();
    });

    it('rejects a negative amount', async () => {
      await post('/api/v1/products')
        .set(authed(ownerToken))
        .send(validBody(`NEG${SKU_MARKER}`, { priceCents: -1 }))
        .expect(422);
    });

    /**
     * Postgres `Int` is int4. Without the cap this reaches the driver as "value out
     * of range for type integer" — a 500 for a plainly bad request.
     */
    it('rejects an amount above int4 with 422, not 500', async () => {
      await post('/api/v1/products')
        .set(authed(ownerToken))
        .send(
          validBody(`HUGE${SKU_MARKER}`, { priceCents: MAX_MONEY_MINOR + 1 }),
        )
        .expect(422);
    });

    it('stores and returns the exact integer it was given', async () => {
      const created = await createProduct(`EXACT${SKU_MARKER}`, {
        priceCents: 2999,
        costCents: 1,
      });
      expect(created.priceCents).toBe(2999);
      expect(created.costCents).toBe(1);

      const row = await prisma.product.findUnique({
        where: { id: created.id },
        select: { priceCents: true },
      });
      expect(row?.priceCents).toBe(2999);
    });

    it('rejects a float on PATCH too, not only on create', async () => {
      const created = await createProduct(`PATCHFLOAT${SKU_MARKER}`);
      await patch(`/api/v1/products/${created.id}`)
        .set(authed(ownerToken))
        .send({ priceCents: 89.99 })
        .expect(422);
    });
  });

  describe('stock is not writable here (Section 6.6)', () => {
    /**
     * Section 6.6: "`stock` is not writable here. Stock changes go through
     * `POST /inventory/adjustments` (6.8) so every change is audited." Under
     * `forbidNonWhitelisted` the attempt is a 422 rather than a silently ignored
     * field — a client must not be able to believe it moved stock when it did not.
     */
    it('answers 422 when a PATCH body includes stock', async () => {
      const created = await createProduct(`NOSTOCK${SKU_MARKER}`, {
        initialStock: 5,
      });

      await patch(`/api/v1/products/${created.id}`)
        .set(authed(ownerToken))
        .send({ stock: 999 })
        .expect(422);

      const row = await prisma.product.findUnique({
        where: { id: created.id },
        select: { stock: true },
      });
      expect(row?.stock).toBe(5);
    });

    it('answers 422 when a POST body includes stock instead of initialStock', async () => {
      await post('/api/v1/products')
        .set(authed(ownerToken))
        .send(validBody(`POSTSTOCK${SKU_MARKER}`, { stock: 7 }))
        .expect(422);
    });

    it('accepts initialStock on create and defaults it to 0', async () => {
      const withStock = await createProduct(`INIT${SKU_MARKER}`, {
        initialStock: 42,
      });
      expect(withStock.stock).toBe(42);

      const without = await createProduct(`NOINIT${SKU_MARKER}`);
      expect(without.stock).toBe(0);
    });
  });

  describe('GET /products', () => {
    it('computes isLowStock server-side at the boundary', async () => {
      const low = await createProduct(`LOW${SKU_MARKER}`, {
        initialStock: 3,
        reorderPoint: 10,
      });
      const atPoint = await createProduct(`AT${SKU_MARKER}`, {
        initialStock: 10,
        reorderPoint: 10,
      });
      const healthy = await createProduct(`OK${SKU_MARKER}`, {
        initialStock: 50,
        reorderPoint: 10,
      });

      expect(low.isLowStock).toBe(true);
      // "stock <= reorderPoint" — equal counts as low, per Section 6.6.
      expect(atPoint.isLowStock).toBe(true);
      expect(healthy.isLowStock).toBe(false);
    });

    it('filters ?lowStock=true by comparing two columns', async () => {
      const low = await createProduct(`FILTERLOW${SKU_MARKER}`, {
        initialStock: 1,
        reorderPoint: 99,
      });
      const healthy = await createProduct(`FILTEROK${SKU_MARKER}`, {
        initialStock: 500,
        reorderPoint: 1,
      });

      const res = await get(
        `/api/v1/products?lowStock=true&category=${TEST_CATEGORY}&pageSize=100`,
      )
        .set(authed(ownerToken))
        .expect(200);

      const { data } = bodyOf<PaginatedEnvelope<ProductResponse>>(res);
      expect(data.map((p) => p.id)).toContain(low.id);
      expect(data.map((p) => p.id)).not.toContain(healthy.id);
      expect(data.every((p) => p.isLowStock)).toBe(true);
    });

    it('honours ?lowStock=false as the complement rather than ignoring it', async () => {
      const healthy = await createProduct(`COMPOK${SKU_MARKER}`, {
        initialStock: 500,
        reorderPoint: 1,
      });
      const low = await createProduct(`COMPLOW${SKU_MARKER}`, {
        initialStock: 0,
        reorderPoint: 5,
      });

      const res = await get(
        `/api/v1/products?lowStock=false&category=${TEST_CATEGORY}&pageSize=100`,
      )
        .set(authed(ownerToken))
        .expect(200);

      const { data } = bodyOf<PaginatedEnvelope<ProductResponse>>(res);
      expect(data.map((p) => p.id)).toContain(healthy.id);
      expect(data.map((p) => p.id)).not.toContain(low.id);
    });

    it('matches ?search= against SKU as well as name', async () => {
      const created = await createProduct(`FINDBYSKU${SKU_MARKER}`, {
        name: 'Unsearchable Name',
      });

      const res = await get('/api/v1/products?search=findbysku&pageSize=100')
        .set(authed(ownerToken))
        .expect(200);
      expect(
        bodyOf<PaginatedEnvelope<ProductResponse>>(res).data.map((p) => p.id),
      ).toContain(created.id);
    });

    it('filters ?category= exactly', async () => {
      const mine = await createProduct(`CATMINE${SKU_MARKER}`);

      const res = await get(
        `/api/v1/products?category=${TEST_CATEGORY}&pageSize=100`,
      )
        .set(authed(ownerToken))
        .expect(200);

      const { data } = bodyOf<PaginatedEnvelope<ProductResponse>>(res);
      expect(data.map((p) => p.id)).toContain(mine.id);
      expect(data.every((p) => p.category === TEST_CATEGORY)).toBe(true);
    });

    it('answers 400 for a bad query param and 401 anonymously', async () => {
      await get('/api/v1/products?lowStock=sometimes')
        .set(authed(ownerToken))
        .expect(400);
      await get('/api/v1/products').expect(401);
    });

    it('is readable by a Cashier, who must price items at the till', async () => {
      await get('/api/v1/products').set(authed(cashierToken)).expect(200);
    });
  });

  describe('POST /products', () => {
    it('rejects a duplicate SKU with 409', async () => {
      await createProduct(`DUPE${SKU_MARKER}`);
      await post('/api/v1/products')
        .set(authed(ownerToken))
        .send(validBody(`DUPE${SKU_MARKER}`))
        .expect(409);
    });

    it('rejects a SKU under three characters', async () => {
      await post('/api/v1/products')
        .set(authed(ownerToken))
        .send(validBody('AB'))
        .expect(422);
    });

    it('refuses a Cashier, who has inventory.read only', async () => {
      await post('/api/v1/products')
        .set(authed(cashierToken))
        .send(validBody(`CASHIER${SKU_MARKER}`))
        .expect(403);
    });
  });

  describe('PATCH /products/:id', () => {
    it('leaves omitted fields alone', async () => {
      const created = await createProduct(`PARTIAL${SKU_MARKER}`, {
        costCents: 1200,
      });

      const res = await patch(`/api/v1/products/${created.id}`)
        .set(authed(ownerToken))
        .send({ priceCents: 3499 })
        .expect(200);

      const body = bodyOf<ProductResponse>(res);
      expect(body.priceCents).toBe(3499);
      expect(body.costCents).toBe(1200);
      expect(body.name).toBe('Test Widget');
    });

    it('rejects a SKU another live product holds', async () => {
      const first = await createProduct(`SKUCLASH1${SKU_MARKER}`);
      await createProduct(`SKUCLASH2${SKU_MARKER}`);

      await patch(`/api/v1/products/${first.id}`)
        .set(authed(ownerToken))
        .send({ sku: `SKUCLASH2${SKU_MARKER}` })
        .expect(409);
    });

    it('answers 404 for an absent id and 400 for a malformed one', async () => {
      await patch(`/api/v1/products/${ABSENT_UUID}`)
        .set(authed(ownerToken))
        .send({ priceCents: 1 })
        .expect(404);
      await patch('/api/v1/products/not-a-uuid')
        .set(authed(ownerToken))
        .send({ priceCents: 1 })
        .expect(400);
    });

    it('is allowed for a Manager', async () => {
      const created = await createProduct(`MGRPATCH${SKU_MARKER}`);
      await patch(`/api/v1/products/${created.id}`)
        .set(authed(managerToken))
        .send({ priceCents: 1500 })
        .expect(200);
    });
  });

  describe('DELETE /products/:id', () => {
    it('soft-deletes a product with no trading history', async () => {
      const created = await createProduct(`DELETABLE${SKU_MARKER}`);

      await del(`/api/v1/products/${created.id}`)
        .set(authed(ownerToken))
        .expect(200);

      const row = await prisma.product.findUnique({
        where: { id: created.id },
        select: { deletedAt: true, isActive: true },
      });
      expect(row?.deletedAt).toBeInstanceOf(Date);
      expect(row?.isActive).toBe(false);

      await get(`/api/v1/products/${created.id}`)
        .set(authed(ownerToken))
        .expect(404);
    });

    /**
     * Section 6.6 as written. See ProductsService.remove and DEBT-022: I believe
     * this rule is wrong — it makes any product that has ever sold undeletable —
     * but it is the documented contract, so it is implemented and tested as
     * specified rather than quietly dropped.
     */
    it('answers 409 for a product that appears on an order line', async () => {
      const created = await createProduct(`SOLD${SKU_MARKER}`, {
        initialStock: 10,
      });

      const order = await prisma.order.create({
        data: {
          tenantId,
          branchId,
          orderNumber: `${ORDER_MARKER}0001`,
          paymentMethod: 'Cash',
          status: 'Completed',
          subtotalCents: 2999,
          totalCents: 2999,
        },
      });
      await prisma.orderLine.create({
        data: {
          orderId: order.id,
          productId: created.id,
          productNameSnapshot: 'Test Widget',
          unitPriceCents: 2999,
          quantity: 1,
          lineTotalCents: 2999,
        },
      });

      const res = await del(`/api/v1/products/${created.id}`)
        .set(authed(ownerToken))
        .expect(409);
      // The message has to offer the way forward, since the endpoint cannot.
      expect(bodyOf<ErrorEnvelope>(res).error.message).toMatch(/isActive/i);

      // Deactivating is the working alternative, and it must still be allowed.
      await patch(`/api/v1/products/${created.id}`)
        .set(authed(ownerToken))
        .send({ isActive: false })
        .expect(200);
    });

    it('frees the SKU for a revive, without resetting audited stock', async () => {
      const first = await createProduct(`REVIVE${SKU_MARKER}`, {
        initialStock: 25,
      });
      await del(`/api/v1/products/${first.id}`)
        .set(authed(ownerToken))
        .expect(200);

      const revived = await createProduct(`REVIVE${SKU_MARKER}`, {
        name: 'Restocked Widget',
        initialStock: 0,
      });

      expect(revived.id).toBe(first.id);
      expect(revived.name).toBe('Restocked Widget');
      // initialStock is ignored on revive: 25 is what the StockAdjustment ledger
      // accounts for, and rewriting it here would contradict that record.
      expect(revived.stock).toBe(25);
    });

    it('refuses a Manager, who lacks inventory.delete', async () => {
      const created = await createProduct(`MGRCANNOT${SKU_MARKER}`);
      await del(`/api/v1/products/${created.id}`)
        .set(authed(managerToken))
        .expect(403);
    });
  });
});
