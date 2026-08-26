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
import { ProductResponse } from '../products/dto/product.dto';
import { RateLimitConfig } from '../rate-limit/rate-limit.config';
import {
  AdjustmentResponse,
  AlertsResponse,
  MAX_ADJUSTMENT_QUANTITY,
} from './dto/inventory.dto';

/**
 * End-to-end coverage of Section 6.8's inventory endpoints.
 *
 * The behaviour this suite exists to protect is the **sign** of `quantityDelta`.
 * The wire format and the stored format disagree on purpose — a client sends
 * `{type: 'REMOVE', quantityDelta: 5}` and the column holds `-5` (DEBT-028) — so
 * that conversion is the thing most likely to be "simplified" by a later reader
 * into a bug that inverts every removal in the audit log while every response
 * still looks plausible. Several tests below assert the stored value directly,
 * not just the response.
 *
 * The second is PROV-BR-07: stock may not go negative. `StockAdjustmentDialog`
 * checks it client-side, but that is an affordance; these tests are the guarantee.
 *
 * ISOLATION (C-05). Products carry `-INVTEST` in their SKU and users `.invtest@`.
 * Adjustments are found through their product, since the server allocates their
 * ids and they carry no marker of their own.
 *
 * Alert assertions test *membership*, never counts or array equality: the dev
 * database is shared and sibling suites create their own products concurrently.
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

const SKU_MARKER = '-INVTEST';
const USER_MARKER = '.invtest@dev.local';
const OWNER_EMAIL = `owner${USER_MARKER}`;
const MANAGER_EMAIL = `manager${USER_MARKER}`;
const CASHIER_EMAIL = `cashier${USER_MARKER}`;
const TEST_PASSWORD = 'InvTest0!';
const ABSENT_UUID = '00000000-0000-4000-8000-000000000000';

describe('Inventory (e2e)', () => {
  jest.setTimeout(120_000);

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
  }, 180_000);

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
   * Adjustments reference products without a cascade, so they go first. Nothing
   * here creates an order, so no order line holds these products.
   */
  async function cleanUp(): Promise<void> {
    await prisma.stockAdjustment.deleteMany({
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

  let skuCounter = 0;

  /**
   * Created through the API, where `initialStock` is the one way stock arrives
   * without an adjustment behind it — which is what lets the tests below assert
   * that a refused adjustment left *no* audit row.
   */
  async function makeProduct(
    initialStock: number,
    overrides: Record<string, unknown> = {},
  ): Promise<ProductResponse> {
    skuCounter += 1;
    const res = await post('/api/v1/products')
      .set(authed(ownerToken))
      .send({
        name: `Invtest Item ${skuCounter}`,
        sku: `INV${skuCounter}${SKU_MARKER}`,
        category: 'InvtestCategory',
        priceCents: 10_000,
        costCents: 1,
        uom: 'piece',
        reorderPoint: 0,
        initialStock,
        ...overrides,
      })
      .expect(201);
    return bodyOf<ProductResponse>(res);
  }

  const adjustBody = (
    productId: string,
    type: string,
    quantityDelta: number,
    reasonCode = 'Correction',
    overrides: Record<string, unknown> = {},
  ) => ({ productId, branchId, type, quantityDelta, reasonCode, ...overrides });

  const fileAdjustment = (body: Record<string, unknown>, token = ownerToken) =>
    post('/api/v1/inventory/adjustments').set(authed(token)).send(body);

  async function stockOf(productId: string): Promise<number> {
    const row = await prisma.product.findUniqueOrThrow({
      where: { id: productId },
      select: { stock: true },
    });
    return row.stock;
  }

  const adjustmentCount = (productId: string) =>
    prisma.stockAdjustment.count({ where: { productId } });

  // ---------------------------------------------------------------------------
  // The sign conversion (DEBT-028) — the reason this suite exists.
  // ---------------------------------------------------------------------------

  describe('quantityDelta sign', () => {
    it('stores an ADD as a positive delta and increments stock', async () => {
      const product = await makeProduct(10);

      const res = await fileAdjustment(
        adjustBody(product.id, 'ADD', 5, 'Received'),
      ).expect(201);

      const body = bodyOf<AdjustmentResponse>(res);
      expect(body.quantityDelta).toBe(5);
      expect(body.newStockLevel).toBe(15);
      expect(body.type).toBe('ADD');
      expect(body.reasonCode).toBe('Received');
      expect(body.productName).toBe(product.name);
      expect(body.branchId).toBe(branchId);
      expect(await stockOf(product.id)).toBe(15);
    });

    /**
     * The headline case. The request carries a positive 5 — Section 6.8's own
     * example — and the column must hold -5, so the log sums correctly and agrees
     * with what Section 6.7's completion path writes for a sale.
     */
    it('stores a REMOVE as a NEGATIVE delta though the request was positive', async () => {
      const product = await makeProduct(10);

      const res = await fileAdjustment(
        adjustBody(product.id, 'REMOVE', 5, 'Damaged'),
      ).expect(201);

      const body = bodyOf<AdjustmentResponse>(res);
      expect(body.quantityDelta).toBe(-5);
      expect(body.newStockLevel).toBe(5);
      expect(await stockOf(product.id)).toBe(5);

      const stored = await prisma.stockAdjustment.findUniqueOrThrow({
        where: { id: body.id },
        select: { quantityDelta: true, newStockLevel: true },
      });
      expect(stored.quantityDelta).toBe(-5);
      expect(stored.newStockLevel).toBe(5);
    });

    it('refuses a client-sent negative quantity rather than double-negating it', async () => {
      const product = await makeProduct(10);

      await fileAdjustment(adjustBody(product.id, 'REMOVE', -5)).expect(422);

      expect(await stockOf(product.id)).toBe(10);
      expect(await adjustmentCount(product.id)).toBe(0);
    });

    /** Repeated adjustments compose; each row records the level it produced. */
    it('accumulates across adjustments', async () => {
      const product = await makeProduct(10);

      for (const [type, qty] of [
        ['ADD', 5],
        ['REMOVE', 3],
        ['ADD', 1],
      ] as const) {
        await fileAdjustment(adjustBody(product.id, type, qty)).expect(201);
      }

      expect(await stockOf(product.id)).toBe(13);

      const res = await get(
        `/api/v1/inventory/adjustments?productId=${product.id}`,
      )
        .set(authed(ownerToken))
        .expect(200);
      const rows = bodyOf<PaginatedEnvelope<AdjustmentResponse>>(res).data;

      expect(rows).toHaveLength(3);
      // Newest first, and the deltas sum to the movement off the initial 10.
      expect(rows[0].newStockLevel).toBe(13);
      expect(rows.reduce((sum, r) => sum + r.quantityDelta, 0)).toBe(3);
    });
  });

  // ---------------------------------------------------------------------------
  // COUNT — absolute, not relative.
  // ---------------------------------------------------------------------------

  describe('COUNT', () => {
    it('sets the absolute level and stores the derived (negative) delta', async () => {
      const product = await makeProduct(10);

      const res = await fileAdjustment(
        adjustBody(product.id, 'COUNT', 4),
      ).expect(201);

      const body = bodyOf<AdjustmentResponse>(res);
      // 4 counted against 10 believed: the delta is -6, not 4.
      expect(body.quantityDelta).toBe(-6);
      expect(body.newStockLevel).toBe(4);
      expect(await stockOf(product.id)).toBe(4);
    });

    it('stores a positive delta when the count is higher than believed', async () => {
      const product = await makeProduct(3);

      const res = await fileAdjustment(
        adjustBody(product.id, 'COUNT', 8),
      ).expect(201);

      expect(bodyOf<AdjustmentResponse>(res).quantityDelta).toBe(5);
      expect(await stockOf(product.id)).toBe(8);
    });

    /** A count that agrees is still worth recording: someone verified the shelf. */
    it('records a zero delta when the count agrees with the system', async () => {
      const product = await makeProduct(7);

      const res = await fileAdjustment(
        adjustBody(product.id, 'COUNT', 7),
      ).expect(201);

      const body = bodyOf<AdjustmentResponse>(res);
      expect(body.quantityDelta).toBe(0);
      expect(body.newStockLevel).toBe(7);
      expect(await adjustmentCount(product.id)).toBe(1);
    });

    /**
     * A stock take that finds an empty shelf is the reason the DTO's bound is
     * `@Min(0)` and not `@Min(1)`.
     */
    it('accepts a count of zero', async () => {
      const product = await makeProduct(6);

      const res = await fileAdjustment(
        adjustBody(product.id, 'COUNT', 0),
      ).expect(201);

      const body = bodyOf<AdjustmentResponse>(res);
      expect(body.quantityDelta).toBe(-6);
      expect(body.newStockLevel).toBe(0);
      expect(await stockOf(product.id)).toBe(0);
    });

    /** COUNT is absolute, so a large drop is not the PROV-BR-07 conflict. */
    it('may count far below the current level without a conflict', async () => {
      const product = await makeProduct(100, { reorderPoint: 20 });

      await fileAdjustment(adjustBody(product.id, 'COUNT', 1)).expect(201);

      expect(await stockOf(product.id)).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // PROV-BR-07 — stock may not go negative.
  // ---------------------------------------------------------------------------

  describe('PROV-BR-07', () => {
    it('refuses to remove more than is in stock, changing nothing', async () => {
      const product = await makeProduct(3);

      const res = await fileAdjustment(
        adjustBody(product.id, 'REMOVE', 4),
      ).expect(409);

      expect(bodyOf<ErrorEnvelope>(res).error.message).toMatch(/only 3/);
      expect(await stockOf(product.id)).toBe(3);
      expect(await adjustmentCount(product.id)).toBe(0);
    });

    it('allows removing exactly the remaining stock', async () => {
      const product = await makeProduct(3);

      const res = await fileAdjustment(
        adjustBody(product.id, 'REMOVE', 3),
      ).expect(201);

      expect(bodyOf<AdjustmentResponse>(res).newStockLevel).toBe(0);
      expect(await stockOf(product.id)).toBe(0);
    });

    it('refuses a REMOVE against a product with no stock', async () => {
      const product = await makeProduct(0);

      await fileAdjustment(adjustBody(product.id, 'REMOVE', 1)).expect(409);

      expect(await stockOf(product.id)).toBe(0);
      expect(await adjustmentCount(product.id)).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Body validation.
  // ---------------------------------------------------------------------------

  describe('validation', () => {
    it.each(['ADD', 'REMOVE'])(
      'refuses a %s of zero as a meaningless audit row',
      async (type) => {
        const product = await makeProduct(5);

        const res = await fileAdjustment(
          adjustBody(product.id, type, 0),
        ).expect(422);

        expect(bodyOf<ErrorEnvelope>(res).error.message).toMatch(
          /changes nothing/,
        );
        expect(await adjustmentCount(product.id)).toBe(0);
      },
    );

    /**
     * Section 6.8 has the server set `newStockLevel`. The pipe runs
     * `forbidNonWhitelisted`, so a client that sends one is refused rather than
     * quietly ignored — the same reading DEBT-025 records for order totals.
     */
    it('refuses a client-submitted newStockLevel', async () => {
      const product = await makeProduct(5);

      await fileAdjustment(
        adjustBody(product.id, 'ADD', 1, 'Received', { newStockLevel: 999 }),
      ).expect(422);

      expect(await stockOf(product.id)).toBe(5);
      expect(await adjustmentCount(product.id)).toBe(0);
    });

    it('refuses a client-submitted createdByUserId', async () => {
      const product = await makeProduct(5);

      await fileAdjustment(
        adjustBody(product.id, 'ADD', 1, 'Received', {
          createdByUserId: ABSENT_UUID,
        }),
      ).expect(422);
    });

    /**
     * `Sale` and `PurchaseReceived` are written by order completion and PO
     * receipt. Accepting them here would let a user forge a sale-shaped audit row
     * with no order behind it.
     */
    it.each(['Sale', 'PurchaseReceived'])(
      'refuses the system-only reason code %s',
      async (reasonCode) => {
        const product = await makeProduct(5);

        await fileAdjustment(
          adjustBody(product.id, 'ADD', 1, reasonCode),
        ).expect(422);

        expect(await adjustmentCount(product.id)).toBe(0);
      },
    );

    it('refuses an unknown reason code', async () => {
      const product = await makeProduct(5);
      await fileAdjustment(
        adjustBody(product.id, 'ADD', 1, 'Shrinkage'),
      ).expect(422);
    });

    it('refuses an unknown type', async () => {
      const product = await makeProduct(5);
      await fileAdjustment(adjustBody(product.id, 'SET', 1)).expect(422);
    });

    it('refuses a fractional quantity', async () => {
      const product = await makeProduct(5);
      await fileAdjustment(adjustBody(product.id, 'ADD', 1.5)).expect(422);
    });

    it('refuses a quantity above the per-adjustment cap', async () => {
      const product = await makeProduct(5);
      await fileAdjustment(
        adjustBody(product.id, 'ADD', MAX_ADJUSTMENT_QUANTITY + 1),
      ).expect(422);
    });

    it('refuses a body missing required fields', async () => {
      await fileAdjustment({ type: 'ADD', quantityDelta: 1 }).expect(422);
    });

    it('refuses an unknown productId with 422, not 404', async () => {
      const res = await fileAdjustment(
        adjustBody(ABSENT_UUID, 'ADD', 1),
      ).expect(422);

      expect(bodyOf<ErrorEnvelope>(res).error.message).toMatch(/productId/);
    });

    /**
     * Soft-deleted through Prisma rather than `DELETE /products/:id`, because that
     * route also clears `isActive` — going through it would leave the test passing
     * for either reason and prove neither. The service filters on `deletedAt`
     * alone, and this is what pins that.
     */
    it('refuses a soft-deleted product', async () => {
      const product = await makeProduct(5);
      await prisma.product.update({
        where: { id: product.id },
        data: { deletedAt: new Date() },
      });

      await fileAdjustment(adjustBody(product.id, 'ADD', 1)).expect(422);
      expect(await adjustmentCount(product.id)).toBe(0);
    });

    /**
     * The mirror of the above: `isActive: false` is a retired product line, not a
     * deleted one, and its remaining stock still has to be written off.
     */
    it('accepts an adjustment against an inactive product', async () => {
      const product = await makeProduct(5, { isActive: false });

      await fileAdjustment(
        adjustBody(product.id, 'REMOVE', 5, 'Damaged'),
      ).expect(201);

      expect(await stockOf(product.id)).toBe(0);
    });

    it('refuses an unknown branchId', async () => {
      const product = await makeProduct(5);
      const res = await fileAdjustment({
        productId: product.id,
        branchId: ABSENT_UUID,
        type: 'ADD',
        quantityDelta: 1,
        reasonCode: 'Received',
      }).expect(422);

      expect(bodyOf<ErrorEnvelope>(res).error.message).toMatch(/branchId/);
      expect(await stockOf(product.id)).toBe(5);
    });
  });

  // ---------------------------------------------------------------------------
  // Permissions. Cashier is read-only on inventory (ROLE_MATRIX).
  // ---------------------------------------------------------------------------

  describe('permissions', () => {
    it('lets a Manager file an adjustment', async () => {
      const product = await makeProduct(5);

      const res = await fileAdjustment(
        adjustBody(product.id, 'ADD', 2, 'Received'),
        managerToken,
      ).expect(201);

      expect(bodyOf<AdjustmentResponse>(res).newStockLevel).toBe(7);
    });

    it('attributes the adjustment to the caller, not the body', async () => {
      const product = await makeProduct(5);
      const manager = await prisma.user.findFirstOrThrow({
        where: { tenantId, email: MANAGER_EMAIL },
        select: { id: true },
      });

      const res = await fileAdjustment(
        adjustBody(product.id, 'ADD', 1, 'Received'),
        managerToken,
      ).expect(201);

      expect(bodyOf<AdjustmentResponse>(res).createdByUserId).toBe(manager.id);
    });

    it('refuses a Cashier with 403 and changes nothing', async () => {
      const product = await makeProduct(5);

      await fileAdjustment(
        adjustBody(product.id, 'ADD', 2, 'Received'),
        cashierToken,
      ).expect(403);

      expect(await stockOf(product.id)).toBe(5);
      expect(await adjustmentCount(product.id)).toBe(0);
    });

    it('lets a Cashier read the log and the alerts', async () => {
      await get('/api/v1/inventory/adjustments')
        .set(authed(cashierToken))
        .expect(200);
      await get('/api/v1/inventory/alerts')
        .set(authed(cashierToken))
        .expect(200);
    });

    it('refuses an unauthenticated caller with 401', async () => {
      await get('/api/v1/inventory/adjustments').expect(401);
      await get('/api/v1/inventory/alerts').expect(401);
      await post('/api/v1/inventory/adjustments').send({}).expect(401);
    });
  });

  // ---------------------------------------------------------------------------
  // The log is append-only.
  // ---------------------------------------------------------------------------

  describe('append-only', () => {
    it('has no route to edit or delete an adjustment', async () => {
      const product = await makeProduct(5);
      const res = await fileAdjustment(
        adjustBody(product.id, 'ADD', 1, 'Received'),
      ).expect(201);
      const { id } = bodyOf<AdjustmentResponse>(res);

      await patch(`/api/v1/inventory/adjustments/${id}`)
        .set(authed(ownerToken))
        .send({ quantityDelta: 99 })
        .expect(404);
      await del(`/api/v1/inventory/adjustments/${id}`)
        .set(authed(ownerToken))
        .expect(404);

      expect(await stockOf(product.id)).toBe(6);
      expect(await adjustmentCount(product.id)).toBe(1);
    });

    /** `PATCH /products/:id` is not a back door to `stock` (Section 6.6). */
    it('is the only client-facing write path to stock', async () => {
      const product = await makeProduct(5);

      await patch(`/api/v1/products/${product.id}`)
        .set(authed(ownerToken))
        .send({ stock: 500 })
        .expect(422);

      expect(await stockOf(product.id)).toBe(5);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /inventory/adjustments — the audit log.
  // ---------------------------------------------------------------------------

  describe('GET /inventory/adjustments', () => {
    it('filters by productId', async () => {
      const mine = await makeProduct(10);
      const other = await makeProduct(10);
      for (const id of [mine.id, mine.id, other.id]) {
        await fileAdjustment(adjustBody(id, 'ADD', 1, 'Received')).expect(201);
      }

      const res = await get(
        `/api/v1/inventory/adjustments?productId=${mine.id}`,
      )
        .set(authed(ownerToken))
        .expect(200);

      const body = bodyOf<PaginatedEnvelope<AdjustmentResponse>>(res);
      expect(body.data).toHaveLength(2);
      expect(body.pagination.total).toBe(2);
      expect(body.data.every((a) => a.productId === mine.id)).toBe(true);
    });

    it('filters by type', async () => {
      const product = await makeProduct(10);
      await fileAdjustment(
        adjustBody(product.id, 'ADD', 4, 'Received'),
      ).expect(201);
      await fileAdjustment(
        adjustBody(product.id, 'REMOVE', 2, 'Damaged'),
      ).expect(201);

      const res = await get(
        `/api/v1/inventory/adjustments?productId=${product.id}&type=REMOVE`,
      )
        .set(authed(ownerToken))
        .expect(200);

      const body = bodyOf<PaginatedEnvelope<AdjustmentResponse>>(res);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].quantityDelta).toBe(-2);
    });

    it('filters by branchId', async () => {
      const product = await makeProduct(10);
      await fileAdjustment(
        adjustBody(product.id, 'ADD', 1, 'Received'),
      ).expect(201);

      const here = await get(
        `/api/v1/inventory/adjustments?productId=${product.id}&branchId=${branchId}`,
      )
        .set(authed(ownerToken))
        .expect(200);
      expect(
        bodyOf<PaginatedEnvelope<AdjustmentResponse>>(here).data,
      ).toHaveLength(1);

      const elsewhere = await get(
        `/api/v1/inventory/adjustments?productId=${product.id}&branchId=${ABSENT_UUID}`,
      )
        .set(authed(ownerToken))
        .expect(200);
      expect(
        bodyOf<PaginatedEnvelope<AdjustmentResponse>>(elsewhere).data,
      ).toHaveLength(0);
    });

    /**
     * A bare `dateTo` must cover the whole of that day. The bound is derived from
     * `toISOString` so the test reads the same UTC day `dateRange` widens to,
     * rather than the runner's local one.
     */
    it('includes today when dateTo is a bare date', async () => {
      const product = await makeProduct(10);
      await fileAdjustment(
        adjustBody(product.id, 'ADD', 1, 'Received'),
      ).expect(201);

      const today = new Date().toISOString().slice(0, 10);
      const res = await get(
        `/api/v1/inventory/adjustments?productId=${product.id}` +
          `&dateFrom=${today}&dateTo=${today}`,
      )
        .set(authed(ownerToken))
        .expect(200);

      expect(
        bodyOf<PaginatedEnvelope<AdjustmentResponse>>(res).data,
      ).toHaveLength(1);
    });

    it('excludes an adjustment outside the range', async () => {
      const product = await makeProduct(10);
      await fileAdjustment(
        adjustBody(product.id, 'ADD', 1, 'Received'),
      ).expect(201);

      const res = await get(
        `/api/v1/inventory/adjustments?productId=${product.id}` +
          '&dateFrom=2000-01-01&dateTo=2000-01-02',
      )
        .set(authed(ownerToken))
        .expect(200);

      expect(
        bodyOf<PaginatedEnvelope<AdjustmentResponse>>(res).data,
      ).toHaveLength(0);
    });

    it('paginates', async () => {
      const product = await makeProduct(10);
      for (let i = 0; i < 3; i += 1) {
        await fileAdjustment(
          adjustBody(product.id, 'ADD', 1, 'Received'),
        ).expect(201);
      }

      const res = await get(
        `/api/v1/inventory/adjustments?productId=${product.id}&pageSize=2`,
      )
        .set(authed(ownerToken))
        .expect(200);

      const body = bodyOf<PaginatedEnvelope<AdjustmentResponse>>(res);
      expect(body.data).toHaveLength(2);
      expect(body.pagination).toMatchObject({
        pageIndex: 0,
        pageSize: 2,
        pageCount: 2,
        total: 3,
      });
    });

    it.each([
      ['an unknown type', 'type=Nonsense'],
      ['a non-uuid productId', 'productId=not-a-uuid'],
      ['a non-date dateFrom', 'dateFrom=not-a-date'],
      ['an impossible calendar date', 'dateFrom=2026-02-30'],
      ['a pageSize over the maximum', 'pageSize=101'],
      ['an unknown query parameter', 'reasonCode=Damaged'],
    ])('rejects %s with 400', async (_label, qs) => {
      await get(`/api/v1/inventory/adjustments?${qs}`)
        .set(authed(ownerToken))
        .expect(400);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /inventory/alerts
  // ---------------------------------------------------------------------------

  describe('GET /inventory/alerts', () => {
    const idsIn = (list: { id: string }[]) => list.map((p) => p.id);

    const fetchAlerts = async (): Promise<AlertsResponse> => {
      const res = await get('/api/v1/inventory/alerts')
        .set(authed(ownerToken))
        .expect(200);
      return bodyOf<AlertsResponse>(res);
    };

    it('reports a zero-stock product as out of stock, not low stock', async () => {
      const product = await makeProduct(0, { reorderPoint: 5 });

      const alerts = await fetchAlerts();

      expect(idsIn(alerts.outOfStock)).toContain(product.id);
      expect(idsIn(alerts.lowStock)).not.toContain(product.id);
    });

    it('reports a product at or below its reorder point as low stock', async () => {
      const below = await makeProduct(2, { reorderPoint: 5 });
      const atPoint = await makeProduct(5, { reorderPoint: 5 });

      const alerts = await fetchAlerts();

      expect(idsIn(alerts.lowStock)).toContain(below.id);
      expect(idsIn(alerts.lowStock)).toContain(atPoint.id);
      expect(idsIn(alerts.outOfStock)).not.toContain(below.id);
    });

    it('omits a product one above its reorder point', async () => {
      const product = await makeProduct(6, { reorderPoint: 5 });

      const alerts = await fetchAlerts();

      expect(idsIn(alerts.lowStock)).not.toContain(product.id);
      expect(idsIn(alerts.outOfStock)).not.toContain(product.id);
    });

    it('omits an inactive product even when it is out of stock', async () => {
      const product = await makeProduct(0, {
        reorderPoint: 5,
        isActive: false,
      });

      const alerts = await fetchAlerts();

      expect(idsIn(alerts.outOfStock)).not.toContain(product.id);
      expect(idsIn(alerts.lowStock)).not.toContain(product.id);
    });

    it('omits a soft-deleted product', async () => {
      const product = await makeProduct(0, { reorderPoint: 5 });
      await prisma.product.update({
        where: { id: product.id },
        data: { deletedAt: new Date() },
      });

      const alerts = await fetchAlerts();

      expect(idsIn(alerts.outOfStock)).not.toContain(product.id);
      expect(idsIn(alerts.lowStock)).not.toContain(product.id);
    });

    it('keeps the two lists disjoint', async () => {
      await makeProduct(0, { reorderPoint: 5 });
      await makeProduct(2, { reorderPoint: 5 });

      const alerts = await fetchAlerts();

      const low = new Set(idsIn(alerts.lowStock));
      expect(idsIn(alerts.outOfStock).filter((id) => low.has(id))).toEqual([]);
    });

    /**
     * The shipped column default is `reorderPoint: 0`, so treating it as a
     * threshold would put every stocked product in the widget.
     */
    it('does not treat the default reorderPoint of 0 as an alert', async () => {
      const product = await makeProduct(1);

      const alerts = await fetchAlerts();

      expect(idsIn(alerts.lowStock)).not.toContain(product.id);
      expect(idsIn(alerts.outOfStock)).not.toContain(product.id);
    });

    /** An adjustment that empties the shelf must move the product between lists. */
    it('reflects an adjustment immediately', async () => {
      const product = await makeProduct(4, { reorderPoint: 10 });

      expect(idsIn((await fetchAlerts()).lowStock)).toContain(product.id);

      await fileAdjustment(
        adjustBody(product.id, 'REMOVE', 4, 'Damaged'),
      ).expect(201);

      const alerts = await fetchAlerts();
      expect(idsIn(alerts.outOfStock)).toContain(product.id);
      expect(idsIn(alerts.lowStock)).not.toContain(product.id);
    });

    /** Scarcest first, so the cap truncates the least urgent rather than a random tail. */
    it('orders low stock ascending by stock', async () => {
      const alerts = await fetchAlerts();
      const levels = alerts.lowStock.map((p) => p.stock);
      expect(levels).toEqual([...levels].sort((a, b) => a - b));
    });
  });
});
