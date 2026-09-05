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
import { ProductResponse } from '../products/dto/product.dto';
import {
  OrderDetailResponse,
  OrderResponse,
  RefundResponse,
} from './dto/order.dto';

/**
 * End-to-end coverage of Section 6.7's order endpoints.
 *
 * What this suite is really protecting is the arithmetic. Orders are the first
 * records the system computes money into, and BR-03 forbids editing them
 * afterwards — so a rounding error, a snapshot that reads the live price, or a
 * total the client was allowed to name is not a bug that can be fixed later by
 * correcting a row. It has to be refused at the boundary, and these tests are the
 * boundary.
 *
 * ISOLATION (C-05). Products carry `-ORDTEST` in their SKU, users `.ordtest@`,
 * and the customer `.ordtest@`. Every order this suite creates references a marked
 * product, so cleanUp finds them through their lines rather than by order number —
 * the server allocates those and they carry no marker.
 *
 * List assertions filter by this suite's own customer rather than counting rows:
 * the dev database is shared and other suites run concurrently, so a count is not
 * a stable assertion.
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

const SKU_MARKER = '-ORDTEST';
const USER_MARKER = '.ordtest@dev.local';
const OWNER_EMAIL = `owner${USER_MARKER}`;
const MANAGER_EMAIL = `manager${USER_MARKER}`;
const CASHIER_EMAIL = `cashier${USER_MARKER}`;
const CUSTOMER_EMAIL = `customer${USER_MARKER}`;
const TEST_PASSWORD = 'OrdTest0!';
const ABSENT_UUID = '00000000-0000-4000-8000-000000000000';

/** Pakistan's standard GST, and the rate Section 6.7's example uses. */
const GST_BPS = 1700;

describe('Orders (e2e)', () => {
  jest.setTimeout(120_000);

  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let branchId: string;
  let customerId: string;
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

    const customer = await prisma.customer.create({
      data: { tenantId, name: 'Ordtest Customer', email: CUSTOMER_EMAIL },
    });
    customerId = customer.id;

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
   * Order of deletion is forced by the FKs: RefundTransaction and StockAdjustment
   * have no cascade, and OrderLine cascades from Order — so refunds go first,
   * then orders (taking their lines), then the adjustments that reference the
   * products, then the products themselves.
   */
  async function cleanUp(): Promise<void> {
    const marked = { product: { sku: { contains: SKU_MARKER } } };

    await prisma.refundTransaction.deleteMany({
      where: { order: { lines: { some: marked } } },
    });
    await prisma.order.deleteMany({
      where: { tenantId, lines: { some: marked } },
    });
    await prisma.stockAdjustment.deleteMany({ where: marked });
    await prisma.product.deleteMany({
      where: { tenantId, sku: { contains: SKU_MARKER } },
    });
    await prisma.customer.deleteMany({
      where: { tenantId, email: { contains: USER_MARKER } },
    });
    await prisma.refreshToken.deleteMany({
      where: { user: { email: { contains: USER_MARKER } } },
    });
    await prisma.user.deleteMany({
      where: { tenantId, email: { contains: USER_MARKER } },
    });
  }

  let skuCounter = 0;

  /** A product with stock, priced in paisa. */
  async function makeProduct(
    priceCents: number,
    initialStock = 1000,
    overrides: Record<string, unknown> = {},
  ): Promise<ProductResponse> {
    skuCounter += 1;
    const res = await post('/api/v1/products')
      .set(authed(ownerToken))
      .send({
        name: `Ordtest Item ${skuCounter}`,
        sku: `ORD${skuCounter}${SKU_MARKER}`,
        category: 'OrdtestCategory',
        priceCents,
        costCents: 1,
        uom: 'piece',
        reorderPoint: 0,
        initialStock,
        ...overrides,
      })
      .expect(201);
    return bodyOf<ProductResponse>(res);
  }

  function orderBody(
    lines: { productId: string; quantity: number }[],
    overrides: Record<string, unknown> = {},
  ) {
    return {
      customerId,
      branchId,
      paymentMethod: 'Cash',
      taxRateBps: GST_BPS,
      lines,
      ...overrides,
    };
  }

  async function createOrder(
    lines: { productId: string; quantity: number }[],
    overrides: Record<string, unknown> = {},
    token = ownerToken,
  ): Promise<OrderDetailResponse> {
    const res = await post('/api/v1/orders')
      .set(authed(token))
      .send(orderBody(lines, overrides))
      .expect(201);
    return bodyOf<OrderDetailResponse>(res);
  }

  async function completeOrder(
    id: string,
    token = ownerToken,
  ): Promise<OrderDetailResponse> {
    const res = await patch(`/api/v1/orders/${id}/status`)
      .set(authed(token))
      .send({ status: 'Completed' })
      .expect(200);
    return bodyOf<OrderDetailResponse>(res);
  }

  const stockOf = async (id: string): Promise<number> =>
    (
      await prisma.product.findUniqueOrThrow({
        where: { id },
        select: { stock: true },
      })
    ).stock;

  // ---------------------------------------------------------------------------

  describe('the server owns the arithmetic (BR-05)', () => {
    /**
     * The headline test. Rs 1,500 x 2 plus Rs 500 is Rs 3,500.00; 17% GST on that
     * is Rs 595.00; the total is Rs 4,095.00. Every figure is integer paisa, and
     * none of them came from the client.
     */
    it('computes subtotal, tax and total from the lines', async () => {
      const a = await makeProduct(150_000);
      const b = await makeProduct(50_000);

      const order = await createOrder([
        { productId: a.id, quantity: 2 },
        { productId: b.id, quantity: 1 },
      ]);

      expect(order.subtotalCents).toBe(350_000);
      expect(order.taxAmountCents).toBe(59_500);
      expect(order.totalCents).toBe(409_500);
      expect(order.lines).toHaveLength(2);
      expect(order.status).toBe('Pending');
    });

    /**
     * Section 6.7 says a client-submitted total is "silently ignored". This
     * codebase refuses it instead (DEBT-025): the global pipe runs
     * `forbidNonWhitelisted`, and a 201 answering a body that named a total would
     * tell the client its figure had been accepted — on the one record BR-03
     * forbids correcting.
     */
    it.each(['subtotalCents', 'taxAmountCents', 'totalCents'])(
      'refuses a client-submitted %s with 422',
      async (field) => {
        const product = await makeProduct(1000);
        const res = await post('/api/v1/orders')
          .set(authed(ownerToken))
          .send(
            orderBody([{ productId: product.id, quantity: 1 }], {
              [field]: 1,
            }),
          )
          .expect(422);

        expect(bodyOf<ErrorEnvelope>(res).error.details).toBeDefined();
      },
    );

    it('refuses a client-named unitPriceCents on a line', async () => {
      const product = await makeProduct(1000);
      await post('/api/v1/orders')
        .set(authed(ownerToken))
        .send(
          orderBody([
            { productId: product.id, quantity: 1, unitPriceCents: 1 } as never,
          ]),
        )
        .expect(422);
    });

    /** Half-up, and only once: 17.5% of Rs 1.00 is 17.5 paisa, stored as 18. */
    it('rounds tax half-up to a whole paisa', async () => {
      const product = await makeProduct(100);
      const order = await createOrder(
        [{ productId: product.id, quantity: 1 }],
        {
          taxRateBps: 1750,
        },
      );

      expect(order.subtotalCents).toBe(100);
      expect(order.taxAmountCents).toBe(18);
      expect(order.totalCents).toBe(118);
    });

    it('applies an explicit taxRateBps of 0 as zero-rated', async () => {
      const product = await makeProduct(10_000);
      const order = await createOrder(
        [{ productId: product.id, quantity: 1 }],
        {
          taxRateBps: 0,
        },
      );

      expect(order.taxRateBps).toBe(0);
      expect(order.taxAmountCents).toBe(0);
      expect(order.totalCents).toBe(10_000);
    });

    /**
     * An omitted rate falls back to the tenant's setting rather than to 0, so a
     * client that forgets the field does not silently post an untaxed sale. The
     * expected value is read from the database rather than hardcoded, because the
     * seed leaves `defaultTaxRateBps` at its column default.
     */
    it('falls back to the tenant default rate when taxRateBps is omitted', async () => {
      const settings = await prisma.tenantSettings.findFirst({
        where: { tenantId },
        select: { defaultTaxRateBps: true },
      });
      const expected = settings?.defaultTaxRateBps ?? 0;

      const product = await makeProduct(10_000);
      const order = await createOrder(
        [{ productId: product.id, quantity: 1 }],
        { taxRateBps: undefined },
      );

      expect(order.taxRateBps).toBe(expected);
      expect(order.taxAmountCents).toBe(
        Math.round((10_000 * expected) / 10_000),
      );
    });

    /** int4 tops out at Rs 21,474,836.47; the driver's overflow would be a 500. */
    it('refuses a total above int4 with 422, not 500', async () => {
      const product = await makeProduct(MAX_MONEY_MINOR, 10);
      await post('/api/v1/orders')
        .set(authed(ownerToken))
        .send(orderBody([{ productId: product.id, quantity: 2 }]))
        .expect(422);
    });

    it('rejects a float quantity and a zero quantity', async () => {
      const product = await makeProduct(1000);
      await post('/api/v1/orders')
        .set(authed(ownerToken))
        .send(orderBody([{ productId: product.id, quantity: 1.5 }]))
        .expect(422);
      await post('/api/v1/orders')
        .set(authed(ownerToken))
        .send(orderBody([{ productId: product.id, quantity: 0 }]))
        .expect(422);
    });

    it('rejects an order with no lines', async () => {
      await post('/api/v1/orders')
        .set(authed(ownerToken))
        .send(orderBody([]))
        .expect(422);
    });
  });

  describe('snapshots (BR-10)', () => {
    /**
     * The reason `unitPriceCents` is a column and not a join. Repricing the product
     * must not change what an existing order says the customer was charged.
     */
    it('keeps the sale price after the product is repriced', async () => {
      const product = await makeProduct(20_000);
      const order = await createOrder([{ productId: product.id, quantity: 3 }]);

      expect(order.lines[0].unitPriceCents).toBe(20_000);
      expect(order.lines[0].lineTotalCents).toBe(60_000);

      await patch(`/api/v1/products/${product.id}`)
        .set(authed(ownerToken))
        .send({ priceCents: 99_000 })
        .expect(200);

      const res = await get(`/api/v1/orders/${order.id}`)
        .set(authed(ownerToken))
        .expect(200);
      const reread = bodyOf<OrderDetailResponse>(res);

      expect(reread.lines[0].unitPriceCents).toBe(20_000);
      expect(reread.totalCents).toBe(order.totalCents);
    });

    it('keeps the product name after the product is renamed', async () => {
      const product = await makeProduct(5000);
      const order = await createOrder([{ productId: product.id, quantity: 1 }]);
      const soldAs = order.lines[0].productName;

      await patch(`/api/v1/products/${product.id}`)
        .set(authed(ownerToken))
        .send({ name: 'Renamed After Sale' })
        .expect(200);

      const res = await get(`/api/v1/orders/${order.id}`)
        .set(authed(ownerToken))
        .expect(200);
      expect(bodyOf<OrderDetailResponse>(res).lines[0].productName).toBe(
        soldAs,
      );
    });
  });

  describe('order numbers', () => {
    it('allocates distinct #-prefixed numbers', async () => {
      const product = await makeProduct(1000);
      const first = await createOrder([{ productId: product.id, quantity: 1 }]);
      const second = await createOrder([
        { productId: product.id, quantity: 1 },
      ]);

      expect(first.orderNumber).toMatch(/^#\d+$/);
      expect(second.orderNumber).toMatch(/^#\d+$/);
      expect(first.orderNumber).not.toBe(second.orderNumber);
    });
  });

  describe('completion decrements stock (FR-SALE-04, BR-02)', () => {
    it('decrements stock and writes an audited Sale adjustment', async () => {
      const product = await makeProduct(1000, 50);
      const order = await createOrder([{ productId: product.id, quantity: 4 }]);

      expect(await stockOf(product.id)).toBe(50);

      const completed = await completeOrder(order.id);
      expect(completed.status).toBe('Completed');
      expect(await stockOf(product.id)).toBe(46);

      const adjustments = await prisma.stockAdjustment.findMany({
        where: { productId: product.id },
        select: {
          type: true,
          quantityDelta: true,
          reasonCode: true,
          newStockLevel: true,
          branchId: true,
        },
      });

      expect(adjustments).toHaveLength(1);
      expect(adjustments[0]).toEqual({
        type: 'REMOVE',
        quantityDelta: -4,
        reasonCode: 'Sale',
        newStockLevel: 46,
        branchId,
      });
    });

    /**
     * The same product on two lines is one stock movement of the combined
     * quantity. Checking the lines separately would approve an order whose total
     * exceeds stock, and decrementing per line would be correct only by accident.
     */
    it('aggregates quantities when a product appears on two lines', async () => {
      const product = await makeProduct(1000, 10);
      const order = await createOrder([
        { productId: product.id, quantity: 3 },
        { productId: product.id, quantity: 4 },
      ]);

      await completeOrder(order.id);

      expect(await stockOf(product.id)).toBe(3);
      const adjustments = await prisma.stockAdjustment.findMany({
        where: { productId: product.id },
        select: { quantityDelta: true },
      });
      expect(adjustments).toHaveLength(1);
      expect(adjustments[0].quantityDelta).toBe(-7);
    });

    /** Nothing partial: the order stays Pending and stock is untouched. */
    it('refuses completion with insufficient stock and changes nothing', async () => {
      const plenty = await makeProduct(1000, 100);
      const scarce = await makeProduct(1000, 2);
      const order = await createOrder([
        { productId: plenty.id, quantity: 1 },
        { productId: scarce.id, quantity: 5 },
      ]);

      const res = await patch(`/api/v1/orders/${order.id}/status`)
        .set(authed(ownerToken))
        .send({ status: 'Completed' })
        .expect(409);
      expect(bodyOf<ErrorEnvelope>(res).error.message).toContain('stock');

      expect(await stockOf(plenty.id)).toBe(100);
      expect(await stockOf(scarce.id)).toBe(2);

      const after = await get(`/api/v1/orders/${order.id}`)
        .set(authed(ownerToken))
        .expect(200);
      expect(bodyOf<OrderDetailResponse>(after).status).toBe('Pending');

      expect(
        await prisma.stockAdjustment.count({
          where: { productId: { in: [plenty.id, scarce.id] } },
        }),
      ).toBe(0);
    });
  });

  describe('status transitions (BR-03)', () => {
    it('refuses to complete an already-completed order with 409', async () => {
      const product = await makeProduct(1000, 20);
      const order = await createOrder([{ productId: product.id, quantity: 1 }]);
      await completeOrder(order.id);

      await patch(`/api/v1/orders/${order.id}/status`)
        .set(authed(ownerToken))
        .send({ status: 'Completed' })
        .expect(409);

      // The second attempt must not have taken stock twice.
      expect(await stockOf(product.id)).toBe(19);
    });

    it.each(['Pending', 'Refunded', 'Cancelled'])(
      'refuses a transition to %s with 422',
      async (status) => {
        const product = await makeProduct(1000);
        const order = await createOrder([
          { productId: product.id, quantity: 1 },
        ]);

        await patch(`/api/v1/orders/${order.id}/status`)
          .set(authed(ownerToken))
          .send({ status })
          .expect(422);
      },
    );

    it('404s on an unknown order', async () => {
      await patch(`/api/v1/orders/${ABSENT_UUID}/status`)
        .set(authed(ownerToken))
        .send({ status: 'Completed' })
        .expect(404);
    });
  });

  describe('refunds (BR-03 reversal)', () => {
    async function completedOrder(
      priceCents = 100_000,
      quantity = 1,
    ): Promise<{ order: OrderDetailResponse; productId: string }> {
      const product = await makeProduct(priceCents, 100);
      const order = await createOrder([{ productId: product.id, quantity }]);
      return { order: await completeOrder(order.id), productId: product.id };
    }

    it('creates a RefundTransaction and marks the order Refunded', async () => {
      const { order } = await completedOrder();

      const res = await post(`/api/v1/orders/${order.id}/refund`)
        .set(authed(ownerToken))
        .send({ amountCents: order.totalCents, reason: 'Customer returned it' })
        .expect(201);

      const refund = bodyOf<RefundResponse>(res);
      expect(refund.orderId).toBe(order.id);
      expect(refund.amountCents).toBe(order.totalCents);
      expect(refund.reason).toBe('Customer returned it');
      expect(refund.createdByUserId).toBeTruthy();

      const after = await get(`/api/v1/orders/${order.id}`)
        .set(authed(ownerToken))
        .expect(200);
      const detail = bodyOf<OrderDetailResponse>(after);
      expect(detail.status).toBe('Refunded');
      expect(detail.refundedCents).toBe(order.totalCents);
      expect(detail.refunds).toHaveLength(1);
      // The reversal never rewrites what was charged.
      expect(detail.totalCents).toBe(order.totalCents);
    });

    it('allows several partial refunds and refuses one that overshoots', async () => {
      const { order } = await completedOrder(100_000, 1);
      const total = order.totalCents;

      await post(`/api/v1/orders/${order.id}/refund`)
        .set(authed(ownerToken))
        .send({ amountCents: 40_000 })
        .expect(201);
      await post(`/api/v1/orders/${order.id}/refund`)
        .set(authed(ownerToken))
        .send({ amountCents: 30_000 })
        .expect(201);

      const res = await post(`/api/v1/orders/${order.id}/refund`)
        .set(authed(ownerToken))
        .send({ amountCents: total - 70_000 + 1 })
        .expect(409);
      expect(bodyOf<ErrorEnvelope>(res).error.message).toContain('refundable');

      const after = await get(`/api/v1/orders/${order.id}`)
        .set(authed(ownerToken))
        .expect(200);
      const detail = bodyOf<OrderDetailResponse>(after);
      expect(detail.refundedCents).toBe(70_000);
      expect(detail.refunds).toHaveLength(2);
    });

    it('refuses to refund a Pending order with 409', async () => {
      const product = await makeProduct(1000);
      const order = await createOrder([{ productId: product.id, quantity: 1 }]);

      await post(`/api/v1/orders/${order.id}/refund`)
        .set(authed(ownerToken))
        .send({ amountCents: 100 })
        .expect(409);
    });

    /**
     * v1 refunds carry no line attribution, so the server cannot know what came
     * back. Restoring stock would be a guess written into the count BR-02 exists
     * to keep honest; a physical return is booked through Section 6.8 with reason
     * `Returned`.
     */
    it('does not restore stock', async () => {
      const { order, productId } = await completedOrder(1000, 5);
      const afterSale = await stockOf(productId);

      await post(`/api/v1/orders/${order.id}/refund`)
        .set(authed(ownerToken))
        .send({ amountCents: order.totalCents })
        .expect(201);

      expect(await stockOf(productId)).toBe(afterSale);
    });

    it('rejects a float or negative amount with 422', async () => {
      const { order } = await completedOrder();
      for (const amountCents of [29.99, -1]) {
        await post(`/api/v1/orders/${order.id}/refund`)
          .set(authed(ownerToken))
          .send({ amountCents })
          .expect(422);
      }
    });
  });

  describe('permissions', () => {
    /** Cashier holds sales.write, so the till works. */
    it('lets a Cashier create and complete an order', async () => {
      const product = await makeProduct(1000, 10);
      const order = await createOrder(
        [{ productId: product.id, quantity: 1 }],
        {},
        cashierToken,
      );
      await completeOrder(order.id, cashierToken);
    });

    /**
     * ...but not refund. `sales.refund` is a separate grant, which is BR-03
     * expressed in the permission model rather than in a comment.
     */
    it('refuses a refund to a Cashier and allows it to a Manager', async () => {
      const product = await makeProduct(50_000, 10);
      const order = await createOrder([{ productId: product.id, quantity: 1 }]);
      await completeOrder(order.id);

      await post(`/api/v1/orders/${order.id}/refund`)
        .set(authed(cashierToken))
        .send({ amountCents: 100 })
        .expect(403);

      await post(`/api/v1/orders/${order.id}/refund`)
        .set(authed(managerToken))
        .send({ amountCents: 100 })
        .expect(201);
    });

    it('requires authentication', async () => {
      await get('/api/v1/orders').expect(401);
    });
  });

  describe('no DELETE route exists (BR-03)', () => {
    /**
     * 404, not 403. Section 6.7 is explicit: a 403 would imply the operation
     * exists behind a permission the caller lacks, and no permission grants it.
     */
    it('404s rather than 403s, even for an Owner holding sales.delete', async () => {
      const product = await makeProduct(1000);
      const order = await createOrder([{ productId: product.id, quantity: 1 }]);

      await del(`/api/v1/orders/${order.id}`)
        .set(authed(ownerToken))
        .expect(404);

      // Still there.
      await get(`/api/v1/orders/${order.id}`)
        .set(authed(ownerToken))
        .expect(200);
    });
  });

  describe('references are validated against the tenant', () => {
    it.each([
      ['branchId', { branchId: ABSENT_UUID }],
      ['customerId', { customerId: ABSENT_UUID }],
    ])('refuses an unknown %s with 422', async (_field, override) => {
      const product = await makeProduct(1000);
      await post('/api/v1/orders')
        .set(authed(ownerToken))
        .send(orderBody([{ productId: product.id, quantity: 1 }], override))
        .expect(422);
    });

    it('refuses an unknown productId with 422', async () => {
      await post('/api/v1/orders')
        .set(authed(ownerToken))
        .send(orderBody([{ productId: ABSENT_UUID, quantity: 1 }]))
        .expect(422);
    });

    /** `isActive: false` is how a product is withdrawn from sale. */
    it('refuses a deactivated product with 422', async () => {
      const product = await makeProduct(1000, 10, { isActive: false });
      const res = await post('/api/v1/orders')
        .set(authed(ownerToken))
        .send(orderBody([{ productId: product.id, quantity: 1 }]))
        .expect(422);
      expect(bodyOf<ErrorEnvelope>(res).error.message).toContain('not on sale');
    });

    it('accepts an omitted customerId as a walk-in sale', async () => {
      const product = await makeProduct(1000);
      const res = await post('/api/v1/orders')
        .set(authed(ownerToken))
        .send({
          branchId,
          paymentMethod: 'Cash',
          taxRateBps: GST_BPS,
          lines: [{ productId: product.id, quantity: 1 }],
        })
        .expect(201);
      expect(bodyOf<OrderDetailResponse>(res).customerId).toBeNull();
    });

    it('rejects an unknown paymentMethod with 422', async () => {
      const product = await makeProduct(1000);
      await post('/api/v1/orders')
        .set(authed(ownerToken))
        .send(
          orderBody([{ productId: product.id, quantity: 1 }], {
            paymentMethod: 'Cheque',
          }),
        )
        .expect(422);
    });
  });

  /**
   * `customerName` and `lineCount` are joined onto every order response so a sales
   * list can render a row without a request per row. The alternative — a
   * `GET /customers/:id` per order — is an N+1 on the busiest read in the product,
   * so these two fields are worth a test that fails loudly if the join is dropped.
   */
  describe('list rows carry the customer name and line count', () => {
    it('names the customer and counts the lines', async () => {
      const first = await makeProduct(1000);
      const second = await makeProduct(2500);
      const order = await createOrder([
        { productId: first.id, quantity: 3 },
        { productId: second.id, quantity: 1 },
      ]);

      expect(order.customerName).toBe('Ordtest Customer');
      // Lines, not units: four items were sold across two lines.
      expect(order.lineCount).toBe(2);

      const res = await get(
        `/api/v1/orders?customerId=${customerId}&pageSize=100`,
      )
        .set(authed(ownerToken))
        .expect(200);
      const row = bodyOf<PaginatedEnvelope<OrderResponse>>(res).data.find(
        (o) => o.id === order.id,
      );
      expect(row?.customerName).toBe('Ordtest Customer');
      expect(row?.lineCount).toBe(2);
    });

    it('reports a null customerName for a walk-in sale', async () => {
      const product = await makeProduct(1000);
      const order = await createOrder(
        [{ productId: product.id, quantity: 1 }],
        {
          customerId: null,
        },
      );

      expect(order.customerId).toBeNull();
      expect(order.customerName).toBeNull();
      expect(order.lineCount).toBe(1);
    });

    /**
     * The opposite of `productNameSnapshot`, deliberately: a receipt must keep
     * saying what it said when it printed, but "whose order is this" should follow
     * a rename, because a renamed customer is the same customer.
     */
    it('follows a customer rename, unlike the line name snapshot', async () => {
      const product = await makeProduct(1000);
      const order = await createOrder([{ productId: product.id, quantity: 1 }]);
      const originalLineName = order.lines[0].productName;

      await prisma.customer.update({
        where: { id: customerId },
        data: { name: 'Ordtest Customer Renamed' },
      });

      const res = await get(`/api/v1/orders/${order.id}`)
        .set(authed(ownerToken))
        .expect(200);
      const reread = bodyOf<OrderDetailResponse>(res);

      expect(reread.customerName).toBe('Ordtest Customer Renamed');
      expect(reread.lines[0].productName).toBe(originalLineName);

      await prisma.customer.update({
        where: { id: customerId },
        data: { name: 'Ordtest Customer' },
      });
    });
  });

  describe('list filters', () => {
    const listOf = async (
      qs: string,
    ): Promise<PaginatedEnvelope<OrderResponse>> => {
      const res = await get(`/api/v1/orders?${qs}`)
        .set(authed(ownerToken))
        .expect(200);
      return bodyOf<PaginatedEnvelope<OrderResponse>>(res);
    };

    it('filters by customerId, status and branchId', async () => {
      const product = await makeProduct(1000, 20);
      const pending = await createOrder([
        { productId: product.id, quantity: 1 },
      ]);
      const completed = await createOrder([
        { productId: product.id, quantity: 1 },
      ]);
      await completeOrder(completed.id);

      const mine = await listOf(`customerId=${customerId}&pageSize=100`);
      const ids = mine.data.map((o) => o.id);
      expect(ids).toContain(pending.id);
      expect(ids).toContain(completed.id);

      const onlyPending = await listOf(
        `customerId=${customerId}&status=Pending&pageSize=100`,
      );
      expect(onlyPending.data.map((o) => o.id)).toContain(pending.id);
      expect(onlyPending.data.map((o) => o.id)).not.toContain(completed.id);
      expect(onlyPending.data.every((o) => o.status === 'Pending')).toBe(true);

      const wrongBranch = await listOf(
        `customerId=${customerId}&branchId=${ABSENT_UUID}`,
      );
      expect(wrongBranch.data).toHaveLength(0);
      expect(wrongBranch.pagination.total).toBe(0);
    });

    /**
     * The bug this guards: `?dateTo=<today>` is midnight, so a naive `lte` would
     * drop every order placed during the day it was asked for.
     */
    it('includes today when dateTo is a bare date', async () => {
      const product = await makeProduct(1000);
      const order = await createOrder([{ productId: product.id, quantity: 1 }]);
      const today = new Date().toISOString().slice(0, 10);

      const inRange = await listOf(
        `customerId=${customerId}&dateTo=${today}&pageSize=100`,
      );
      expect(inRange.data.map((o) => o.id)).toContain(order.id);
    });

    it('excludes orders outside the range', async () => {
      const product = await makeProduct(1000);
      const order = await createOrder([{ productId: product.id, quantity: 1 }]);

      const future = await listOf(
        `customerId=${customerId}&dateFrom=2999-01-01&pageSize=100`,
      );
      expect(future.data).toHaveLength(0);

      const past = await listOf(
        `customerId=${customerId}&dateTo=2000-01-01&pageSize=100`,
      );
      expect(past.data).toHaveLength(0);
      expect(order.id).toBeTruthy();
    });

    /** Section 6.1: a bad query parameter is 400, not 422. */
    it.each([
      'status=Nonsense',
      'dateFrom=not-a-date',
      'dateFrom=2026-02-30',
      'customerId=not-a-uuid',
      'pageSize=101',
    ])('answers 400 for ?%s', async (qs) => {
      await get(`/api/v1/orders?${qs}`).set(authed(ownerToken)).expect(400);
    });
  });

  describe('detail', () => {
    it('404s on an unknown order and 400s on a non-uuid', async () => {
      await get(`/api/v1/orders/${ABSENT_UUID}`)
        .set(authed(ownerToken))
        .expect(404);
      await get('/api/v1/orders/not-a-uuid')
        .set(authed(ownerToken))
        .expect(400);
    });
  });
});
