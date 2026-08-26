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
import { ProductResponse } from '../products/dto/product.dto';
import { RateLimitConfig } from '../rate-limit/rate-limit.config';
import {
  INVALID_STATUS_TRANSITION,
  POStatusTransitionResponse,
  PurchaseOrderDetailResponse,
  PurchaseOrderResponse,
} from './dto/purchase-order.dto';

/**
 * End-to-end coverage of Section 6.9's purchase-order endpoints.
 *
 * Three things here are worth more than the rest of the suite combined, because
 * each is a place where a passing-looking implementation would corrupt data that
 * BR-03 forbids correcting afterwards:
 *
 *   1. **The state machine, checked against stored status.** A client that sends a
 *      transition its own UI would have hidden must still be refused — with a 409
 *      and `INVALID_STATUS_TRANSITION`, not a generic conflict. This is the
 *      server-side half of DEBT-002, and the only half that is a rule.
 *   2. **Receiving moves stock, exactly once, with an audit row.** A receipt that
 *      left stock alone would understate the count by the delivery; one that ran
 *      twice would overstate it. Both are silent, and both are unfixable in a
 *      ledger that cannot be edited.
 *   3. **`unitCostCents` is the client's to name and the totals are not.** A PO
 *      line's cost is buyer-negotiated (Section 6.9), so it must be accepted — and
 *      it is the one number a client may send, which makes it worth proving the
 *      neighbouring ones are still refused.
 *
 * ISOLATION (C-05). Products carry `-POTEST` in their SKU, users `.potest@`, and
 * suppliers `.potest@`. Every purchase order this suite creates references a marked
 * supplier, so cleanUp finds them that way — PO numbers are server-allocated and
 * carry no marker.
 *
 * List assertions filter by this suite's own supplier rather than counting rows:
 * the dev database is shared and other suites run concurrently, so a bare count is
 * not a stable assertion.
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

const SKU_MARKER = '-POTEST';
const USER_MARKER = '.potest@dev.local';
const OWNER_EMAIL = `owner${USER_MARKER}`;
const MANAGER_EMAIL = `manager${USER_MARKER}`;
const CASHIER_EMAIL = `cashier${USER_MARKER}`;
const SUPPLIER_EMAIL = `supplier${USER_MARKER}`;
const INACTIVE_SUPPLIER_EMAIL = `inactive${USER_MARKER}`;
const TEST_PASSWORD = 'PoTest0!';
const ABSENT_UUID = '00000000-0000-4000-8000-000000000000';

describe('Purchase orders (e2e)', () => {
  jest.setTimeout(120_000);

  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let supplierId: string;
  let inactiveSupplierId: string;
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

    const supplier = await prisma.supplier.create({
      data: { tenantId, name: 'Potest Supplies Ltd', email: SUPPLIER_EMAIL },
    });
    supplierId = supplier.id;

    const inactive = await prisma.supplier.create({
      data: {
        tenantId,
        name: 'Potest Withdrawn Supplies',
        email: INACTIVE_SUPPLIER_EMAIL,
        isActive: false,
      },
    });
    inactiveSupplierId = inactive.id;

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
   * Order of deletion is forced by the FKs. `POStatusTransition` has **no**
   * cascade from `PurchaseOrder` (only `POLine` does), so transitions go first,
   * then the POs — taking their lines with them — then the stock adjustments that
   * reference the marked products, then the products, then the suppliers.
   */
  async function cleanUp(): Promise<void> {
    const marked = { supplier: { email: { contains: USER_MARKER } } };

    await prisma.pOStatusTransition.deleteMany({
      where: { purchaseOrder: marked },
    });
    await prisma.purchaseOrder.deleteMany({ where: { tenantId, ...marked } });
    await prisma.stockAdjustment.deleteMany({
      where: { product: { sku: { contains: SKU_MARKER } } },
    });
    await prisma.product.deleteMany({
      where: { tenantId, sku: { contains: SKU_MARKER } },
    });
    await prisma.supplier.deleteMany({
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

  /** A product with stock, priced and costed in paisa. */
  async function makeProduct(
    costCents = 1000,
    initialStock = 100,
    overrides: Record<string, unknown> = {},
  ): Promise<ProductResponse> {
    skuCounter += 1;
    const res = await post('/api/v1/products')
      .set(authed(ownerToken))
      .send({
        name: `Potest Item ${skuCounter}`,
        sku: `PO${skuCounter}${SKU_MARKER}`,
        category: 'PotestCategory',
        priceCents: costCents * 2,
        costCents,
        uom: 'piece',
        reorderPoint: 0,
        initialStock,
        ...overrides,
      })
      .expect(201);
    return bodyOf<ProductResponse>(res);
  }

  async function createPO(
    lines: { productId: string; unitCostCents: number; quantity: number }[],
    overrides: Record<string, unknown> = {},
    token = ownerToken,
  ): Promise<PurchaseOrderDetailResponse> {
    const res = await post('/api/v1/purchase-orders')
      .set(authed(token))
      .send({ supplierId, lines, ...overrides })
      .expect(201);
    return bodyOf<PurchaseOrderDetailResponse>(res);
  }

  async function move(
    id: string,
    toStatus: string,
    token = ownerToken,
  ): Promise<PurchaseOrderDetailResponse> {
    const res = await patch(`/api/v1/purchase-orders/${id}/status`)
      .set(authed(token))
      .send({ toStatus })
      .expect(200);
    return bodyOf<PurchaseOrderDetailResponse>(res);
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
     * The headline test. Rs 250.00 x 4 plus Rs 99.50 x 3 is Rs 1,298.50 — every
     * figure integer paisa, none of them from the client.
     */
    it('computes line totals, subtotal and total from the lines', async () => {
      const a = await makeProduct();
      const b = await makeProduct();

      const po = await createPO([
        { productId: a.id, unitCostCents: 25_000, quantity: 4 },
        { productId: b.id, unitCostCents: 9_950, quantity: 3 },
      ]);

      const lineA = po.lines.find((l) => l.productId === a.id)!;
      const lineB = po.lines.find((l) => l.productId === b.id)!;
      expect(lineA.lineTotalCents).toBe(100_000);
      expect(lineB.lineTotalCents).toBe(29_850);
      expect(po.subtotalCents).toBe(129_850);
    });

    /**
     * DEBT-033 pinned as behaviour. `PurchaseOrder` has no tax columns, so there
     * is nothing to add to the subtotal and the two are necessarily equal. If tax
     * is added later this test is the one that fails, which is the point — it
     * should not be possible to add tax columns and leave `totalCents` stale.
     */
    it('returns totalCents equal to subtotalCents (no purchase tax yet)', async () => {
      const product = await makeProduct();
      const po = await createPO([
        { productId: product.id, unitCostCents: 33_333, quantity: 3 },
      ]);

      expect(po.subtotalCents).toBe(99_999);
      expect(po.totalCents).toBe(po.subtotalCents);
    });

    it('refuses a client-submitted subtotal or total with 422', async () => {
      const product = await makeProduct();

      for (const field of ['subtotalCents', 'totalCents'] as const) {
        const res = await post('/api/v1/purchase-orders')
          .set(authed(ownerToken))
          .send({
            supplierId,
            lines: [
              { productId: product.id, unitCostCents: 10_000, quantity: 1 },
            ],
            [field]: 1,
          })
          .expect(422);

        const body = bodyOf<ErrorEnvelope>(res);
        expect(body.error.code).toBe('VALIDATION_ERROR');
        expect(JSON.stringify(body.error.details)).toContain(field);
      }
    });

    it('refuses a client-submitted poNumber, status or supplierNameSnapshot', async () => {
      const product = await makeProduct();
      const lines = [
        { productId: product.id, unitCostCents: 10_000, quantity: 1 },
      ];

      for (const [field, value] of [
        ['poNumber', 'PO-1999-001'],
        ['status', 'Received'],
        ['supplierNameSnapshot', 'Someone Else'],
      ] as const) {
        await post('/api/v1/purchase-orders')
          .set(authed(ownerToken))
          .send({ supplierId, lines, [field]: value })
          .expect(422);
      }
    });

    /**
     * The int4 ceiling, reached deliberately. In rupees this is Rs 21,474,836.47 —
     * a figure a wholesale PO can genuinely approach, which is why it is a 422
     * naming the limit rather than a driver overflow surfacing as a 500.
     */
    it('refuses a subtotal past MAX_MONEY_MINOR with 422, not a 500', async () => {
      const product = await makeProduct();

      const res = await post('/api/v1/purchase-orders')
        .set(authed(ownerToken))
        .send({
          supplierId,
          lines: [
            {
              productId: product.id,
              unitCostCents: MAX_MONEY_MINOR,
              quantity: 2,
            },
          ],
        })
        .expect(422);

      expect(bodyOf<ErrorEnvelope>(res).error.message).toContain(
        String(MAX_MONEY_MINOR),
      );
    });
  });

  describe('unitCostCents is the buyer-negotiated cost (Section 6.9)', () => {
    /**
     * The deliberate divergence from orders. An order line's price is snapshotted
     * from the catalogue; a PO line's cost is not, because the supplier quoted
     * what the supplier quoted. If this ever started reading `Product.costCents`,
     * every PO would be wrong from the moment a price was agreed.
     */
    it('stores the submitted cost, not Product.costCents', async () => {
      const product = await makeProduct(5_000);
      const po = await createPO([
        { productId: product.id, unitCostCents: 4_250, quantity: 10 },
      ]);

      expect(po.lines[0].unitCostCents).toBe(4_250);
      expect(po.lines[0].lineTotalCents).toBe(42_500);
    });

    it('leaves Product.costCents untouched when a PO is received', async () => {
      const product = await makeProduct(5_000);
      const po = await createPO([
        { productId: product.id, unitCostCents: 9_999, quantity: 1 },
      ]);

      await move(po.id, 'Sent');
      await move(po.id, 'Received');

      const after = await prisma.product.findUniqueOrThrow({
        where: { id: product.id },
        select: { costCents: true },
      });
      expect(after.costCents).toBe(5_000);
    });

    it('refuses a negative or non-integer cost with 422', async () => {
      const product = await makeProduct();

      for (const unitCostCents of [-1, 10.5]) {
        await post('/api/v1/purchase-orders')
          .set(authed(ownerToken))
          .send({
            supplierId,
            lines: [{ productId: product.id, unitCostCents, quantity: 1 }],
          })
          .expect(422);
      }
    });

    it('accepts a zero cost — a free replacement is a real purchase order', async () => {
      const product = await makeProduct();
      const po = await createPO([
        { productId: product.id, unitCostCents: 0, quantity: 5 },
      ]);

      expect(po.subtotalCents).toBe(0);
      expect(po.lines[0].quantity).toBe(5);
    });
  });

  describe('snapshots (BR-10, Section 6.9)', () => {
    it('snapshots the supplier name onto the header', async () => {
      const product = await makeProduct();
      const po = await createPO([
        { productId: product.id, unitCostCents: 1_000, quantity: 1 },
      ]);

      expect(po.supplierName).toBe('Potest Supplies Ltd');
    });

    /**
     * The asymmetry with orders, made explicit. `OrderResponse.customerName`
     * follows a rename because it points at a living customer record; a PO's
     * supplier name is what the document said when it was sent, and must keep
     * reading that way.
     */
    it('keeps the supplier name as it read when the PO was raised, after a rename', async () => {
      const product = await makeProduct();
      const po = await createPO([
        { productId: product.id, unitCostCents: 1_000, quantity: 1 },
      ]);

      await patch(`/api/v1/suppliers/${supplierId}`)
        .set(authed(ownerToken))
        .send({ name: 'Potest Supplies (Renamed)' })
        .expect(200);

      const res = await get(`/api/v1/purchase-orders/${po.id}`)
        .set(authed(ownerToken))
        .expect(200);

      expect(bodyOf<PurchaseOrderDetailResponse>(res).supplierName).toBe(
        'Potest Supplies Ltd',
      );

      // Restore, so the ordering of tests in this file cannot matter.
      await patch(`/api/v1/suppliers/${supplierId}`)
        .set(authed(ownerToken))
        .send({ name: 'Potest Supplies Ltd' })
        .expect(200);
    });

    it('snapshots the product name onto each line and holds it through a rename', async () => {
      const product = await makeProduct();
      const originalName = product.name;
      const po = await createPO([
        { productId: product.id, unitCostCents: 1_000, quantity: 1 },
      ]);

      await patch(`/api/v1/products/${product.id}`)
        .set(authed(ownerToken))
        .send({ name: 'Potest Item Renamed' })
        .expect(200);

      const res = await get(`/api/v1/purchase-orders/${po.id}`)
        .set(authed(ownerToken))
        .expect(200);

      expect(
        bodyOf<PurchaseOrderDetailResponse>(res).lines[0].productName,
      ).toBe(originalName);
    });
  });

  describe('the state machine is enforced server-side (DEBT-002)', () => {
    it('creates every PO as Draft, whatever the client wants', async () => {
      const product = await makeProduct();
      const po = await createPO([
        { productId: product.id, unitCostCents: 1_000, quantity: 1 },
      ]);

      expect(po.status).toBe('Draft');
      expect(po.statusTransitions).toEqual([]);
    });

    it('allows Draft → Sent → Received', async () => {
      const product = await makeProduct();
      const po = await createPO([
        { productId: product.id, unitCostCents: 1_000, quantity: 1 },
      ]);

      expect((await move(po.id, 'Sent')).status).toBe('Sent');
      expect((await move(po.id, 'Received')).status).toBe('Received');
    });

    it('allows Draft → Cancelled and Sent → Cancelled', async () => {
      const a = await makeProduct();
      const fromDraft = await createPO([
        { productId: a.id, unitCostCents: 1_000, quantity: 1 },
      ]);
      expect((await move(fromDraft.id, 'Cancelled')).status).toBe('Cancelled');

      const b = await makeProduct();
      const fromSent = await createPO([
        { productId: b.id, unitCostCents: 1_000, quantity: 1 },
      ]);
      await move(fromSent.id, 'Sent');
      expect((await move(fromSent.id, 'Cancelled')).status).toBe('Cancelled');
    });

    /**
     * The specified failure, and the reason `ApiExceptionFilter` learned to read a
     * `code` off the thrown payload: a plain 409 is `CONFLICT`, which cannot tell
     * a client whether the transition was wrong or the PO number was taken.
     */
    it('refuses Draft → Received with 409 INVALID_STATUS_TRANSITION', async () => {
      const product = await makeProduct();
      const po = await createPO([
        { productId: product.id, unitCostCents: 1_000, quantity: 1 },
      ]);

      const res = await patch(`/api/v1/purchase-orders/${po.id}/status`)
        .set(authed(ownerToken))
        .send({ toStatus: 'Received' })
        .expect(409);

      const body = bodyOf<ErrorEnvelope>(res);
      expect(body.error.code).toBe(INVALID_STATUS_TRANSITION);
      // The message names what *is* possible, because a client that got here has
      // a stale view and needs the real options.
      expect(body.error.message).toContain('Sent');
    });

    it('treats Received and Cancelled as terminal', async () => {
      const a = await makeProduct();
      const received = await createPO([
        { productId: a.id, unitCostCents: 1_000, quantity: 1 },
      ]);
      await move(received.id, 'Sent');
      await move(received.id, 'Received');

      for (const toStatus of ['Draft', 'Sent', 'Cancelled']) {
        const res = await patch(`/api/v1/purchase-orders/${received.id}/status`)
          .set(authed(ownerToken))
          .send({ toStatus })
          .expect(409);
        expect(bodyOf<ErrorEnvelope>(res).error.code).toBe(
          INVALID_STATUS_TRANSITION,
        );
      }

      const b = await makeProduct();
      const cancelled = await createPO([
        { productId: b.id, unitCostCents: 1_000, quantity: 1 },
      ]);
      await move(cancelled.id, 'Cancelled');

      const res = await patch(`/api/v1/purchase-orders/${cancelled.id}/status`)
        .set(authed(ownerToken))
        .send({ toStatus: 'Sent' })
        .expect(409);
      expect(bodyOf<ErrorEnvelope>(res).error.message).toContain('terminal');
    });

    it('refuses a status outside the vocabulary with 422, not 409', async () => {
      const product = await makeProduct();
      const po = await createPO([
        { productId: product.id, unitCostCents: 1_000, quantity: 1 },
      ]);

      await patch(`/api/v1/purchase-orders/${po.id}/status`)
        .set(authed(ownerToken))
        .send({ toStatus: 'Shipped' })
        .expect(422);
    });

    it('refuses `status` in place of `toStatus` — the field name is the contract', async () => {
      const product = await makeProduct();
      const po = await createPO([
        { productId: product.id, unitCostCents: 1_000, quantity: 1 },
      ]);

      await patch(`/api/v1/purchase-orders/${po.id}/status`)
        .set(authed(ownerToken))
        .send({ status: 'Sent' })
        .expect(422);
    });
  });

  describe('the status history is the audit trail (Section 6.9)', () => {
    it('records every transition, oldest first, attributed to the caller', async () => {
      const product = await makeProduct();
      const po = await createPO([
        { productId: product.id, unitCostCents: 1_000, quantity: 1 },
      ]);

      await move(po.id, 'Sent', managerToken);
      const received = await move(po.id, 'Received', ownerToken);

      expect(received.statusTransitions).toHaveLength(2);
      expect(received.statusTransitions[0]).toMatchObject({
        fromStatus: 'Draft',
        toStatus: 'Sent',
      });
      expect(received.statusTransitions[1]).toMatchObject({
        fromStatus: 'Sent',
        toStatus: 'Received',
      });
      // Different users moved it, and the trail says so.
      expect(received.statusTransitions[0].changedByUserId).not.toBe(
        received.statusTransitions[1].changedByUserId,
      );
    });

    it('exposes the same rows at GET /:id/transitions', async () => {
      const product = await makeProduct();
      const po = await createPO([
        { productId: product.id, unitCostCents: 1_000, quantity: 1 },
      ]);
      await move(po.id, 'Sent');

      const res = await get(`/api/v1/purchase-orders/${po.id}/transitions`)
        .set(authed(ownerToken))
        .expect(200);

      const rows = bodyOf<POStatusTransitionResponse[]>(res);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ fromStatus: 'Draft', toStatus: 'Sent' });
    });

    /**
     * A refused transition must leave no trace. If the 409 wrote a history row
     * first, the trail would claim a move that never happened — worse than no
     * trail, because it reads as authoritative.
     */
    it('writes no history row for a refused transition', async () => {
      const product = await makeProduct();
      const po = await createPO([
        { productId: product.id, unitCostCents: 1_000, quantity: 1 },
      ]);

      await patch(`/api/v1/purchase-orders/${po.id}/status`)
        .set(authed(ownerToken))
        .send({ toStatus: 'Received' })
        .expect(409);

      const res = await get(`/api/v1/purchase-orders/${po.id}/transitions`)
        .set(authed(ownerToken))
        .expect(200);
      expect(bodyOf<POStatusTransitionResponse[]>(res)).toEqual([]);
    });

    it('404s the history of a PO that does not exist', async () => {
      await get(`/api/v1/purchase-orders/${ABSENT_UUID}/transitions`)
        .set(authed(ownerToken))
        .expect(404);
    });
  });

  describe('receiving a PO moves stock (BR-02, Section 6.8 reason codes)', () => {
    it('leaves stock alone until the PO is Received', async () => {
      const product = await makeProduct(1_000, 40);
      const po = await createPO([
        { productId: product.id, unitCostCents: 1_000, quantity: 25 },
      ]);

      expect(await stockOf(product.id)).toBe(40);
      await move(po.id, 'Sent');
      expect(await stockOf(product.id)).toBe(40);

      await move(po.id, 'Received');
      expect(await stockOf(product.id)).toBe(65);
    });

    it('writes a PurchaseReceived StockAdjustment snapshotting the new level', async () => {
      const product = await makeProduct(1_000, 10);
      const po = await createPO([
        { productId: product.id, unitCostCents: 1_000, quantity: 7 },
      ]);
      await move(po.id, 'Sent');
      await move(po.id, 'Received');

      const rows = await prisma.stockAdjustment.findMany({
        where: { productId: product.id },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        type: 'ADD',
        quantityDelta: 7,
        reasonCode: 'PurchaseReceived',
        newStockLevel: 17,
      });
      expect(rows[0].branchId).toBeTruthy();
    });

    /**
     * DEBT-034 pinned as behaviour: with no `PurchaseOrder.branchId`, the receipt
     * lands in the tenant's default branch. When that column is added this test
     * is the one that has to change, which is the point.
     */
    it('books the receipt to the tenant default branch (DEBT-034)', async () => {
      const product = await makeProduct(1_000, 0);
      const po = await createPO([
        { productId: product.id, unitCostCents: 1_000, quantity: 3 },
      ]);
      await move(po.id, 'Sent');
      await move(po.id, 'Received');

      const row = await prisma.stockAdjustment.findFirstOrThrow({
        where: { productId: product.id },
      });
      const branch = await prisma.branch.findUniqueOrThrow({
        where: { id: row.branchId },
        select: { tenantId: true },
      });
      expect(branch.tenantId).toBe(tenantId);
    });

    /**
     * Two lines, one product — a PO listing an item twice at two agreed costs is
     * ordinary. One adjustment, or the audit log would carry two rows each
     * claiming to be the level after the delivery.
     */
    it('sums repeated products into one adjustment', async () => {
      const product = await makeProduct(1_000, 5);
      const po = await createPO([
        { productId: product.id, unitCostCents: 1_000, quantity: 4 },
        { productId: product.id, unitCostCents: 1_200, quantity: 6 },
      ]);
      await move(po.id, 'Sent');
      await move(po.id, 'Received');

      expect(await stockOf(product.id)).toBe(15);

      const rows = await prisma.stockAdjustment.findMany({
        where: { productId: product.id },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ quantityDelta: 10, newStockLevel: 15 });

      // Both lines survive on the PO — the aggregation is a receipt concern, not
      // a reason to lose what was ordered at what cost.
      const detail = await get(`/api/v1/purchase-orders/${po.id}`)
        .set(authed(ownerToken))
        .expect(200);
      expect(bodyOf<PurchaseOrderDetailResponse>(detail).lines).toHaveLength(2);
    });

    it('does not move stock when a PO is cancelled', async () => {
      const product = await makeProduct(1_000, 12);
      const po = await createPO([
        { productId: product.id, unitCostCents: 1_000, quantity: 50 },
      ]);
      await move(po.id, 'Sent');
      await move(po.id, 'Cancelled');

      expect(await stockOf(product.id)).toBe(12);
      expect(
        await prisma.stockAdjustment.count({
          where: { productId: product.id },
        }),
      ).toBe(0);
    });

    /**
     * The second receipt is refused as a transition, which is also what stops the
     * delivery being counted twice — the state machine is the concurrency guard,
     * not a separate check.
     */
    it('cannot receive the same PO twice', async () => {
      const product = await makeProduct(1_000, 0);
      const po = await createPO([
        { productId: product.id, unitCostCents: 1_000, quantity: 9 },
      ]);
      await move(po.id, 'Sent');
      await move(po.id, 'Received');

      await patch(`/api/v1/purchase-orders/${po.id}/status`)
        .set(authed(ownerToken))
        .send({ toStatus: 'Received' })
        .expect(409);

      expect(await stockOf(product.id)).toBe(9);
      expect(
        await prisma.stockAdjustment.count({
          where: { productId: product.id },
        }),
      ).toBe(1);
    });

    /**
     * The overflow guard, and specifically that it fails *whole*: neither product
     * moves, so a partly-applied receipt cannot leave the ledger describing a
     * delivery that was refused.
     */
    it('refuses a receipt that would overflow int4, moving nothing', async () => {
      const safe = await makeProduct(1_000, 5);
      const nearMax = await makeProduct(1_000, 0);
      await prisma.product.update({
        where: { id: nearMax.id },
        data: { stock: 2_147_483_640 },
      });

      const po = await createPO([
        { productId: safe.id, unitCostCents: 1_000, quantity: 3 },
        { productId: nearMax.id, unitCostCents: 1_000, quantity: 100 },
      ]);
      await move(po.id, 'Sent');

      const res = await patch(`/api/v1/purchase-orders/${po.id}/status`)
        .set(authed(ownerToken))
        .send({ toStatus: 'Received' })
        .expect(422);
      expect(bodyOf<ErrorEnvelope>(res).error.message).toContain('Nothing was');

      expect(await stockOf(safe.id)).toBe(5);
      expect(await stockOf(nearMax.id)).toBe(2_147_483_640);

      // And the status did not move either, so the PO can be corrected and
      // received again.
      const detail = await get(`/api/v1/purchase-orders/${po.id}`)
        .set(authed(ownerToken))
        .expect(200);
      expect(bodyOf<PurchaseOrderDetailResponse>(detail).status).toBe('Sent');
      expect(
        bodyOf<PurchaseOrderDetailResponse>(detail).statusTransitions,
      ).toHaveLength(1);
    });
  });

  describe('referenced entities are validated (422, not 500)', () => {
    it('refuses a supplier that does not exist', async () => {
      const product = await makeProduct();
      const res = await post('/api/v1/purchase-orders')
        .set(authed(ownerToken))
        .send({
          supplierId: ABSENT_UUID,
          lines: [{ productId: product.id, unitCostCents: 1_000, quantity: 1 }],
        })
        .expect(422);

      expect(bodyOf<ErrorEnvelope>(res).error.message).toContain('supplier');
    });

    /**
     * The asymmetry with orders, which accept an inactive *customer*. Turning a
     * paying customer away at the till is worse than recording a sale to a dormant
     * account; committing new spend to a supplier the tenant withdrew is not the
     * same trade.
     */
    it('refuses an inactive supplier', async () => {
      const product = await makeProduct();
      const res = await post('/api/v1/purchase-orders')
        .set(authed(ownerToken))
        .send({
          supplierId: inactiveSupplierId,
          lines: [{ productId: product.id, unitCostCents: 1_000, quantity: 1 }],
        })
        .expect(422);

      expect(bodyOf<ErrorEnvelope>(res).error.message).toContain('inactive');
    });

    it('refuses a product that does not exist', async () => {
      const res = await post('/api/v1/purchase-orders')
        .set(authed(ownerToken))
        .send({
          supplierId,
          lines: [
            { productId: ABSENT_UUID, unitCostCents: 1_000, quantity: 1 },
          ],
        })
        .expect(422);

      expect(bodyOf<ErrorEnvelope>(res).error.message).toContain('product');
    });

    it('refuses a withdrawn product', async () => {
      const product = await makeProduct();
      await patch(`/api/v1/products/${product.id}`)
        .set(authed(ownerToken))
        .send({ isActive: false })
        .expect(200);

      const res = await post('/api/v1/purchase-orders')
        .set(authed(ownerToken))
        .send({
          supplierId,
          lines: [{ productId: product.id, unitCostCents: 1_000, quantity: 1 }],
        })
        .expect(422);

      expect(bodyOf<ErrorEnvelope>(res).error.message).toContain('withdrawn');
    });

    it('refuses a soft-deleted product', async () => {
      const product = await makeProduct();
      // 200 with the soft-deleted row, not 204 — `DELETE /products/:id` returns
      // the record it retired, so a caller can show what was removed.
      await del(`/api/v1/products/${product.id}`)
        .set(authed(ownerToken))
        .expect(200);

      await post('/api/v1/purchase-orders')
        .set(authed(ownerToken))
        .send({
          supplierId,
          lines: [{ productId: product.id, unitCostCents: 1_000, quantity: 1 }],
        })
        .expect(422);
    });

    it('refuses an empty line array and a missing quantity', async () => {
      const product = await makeProduct();

      await post('/api/v1/purchase-orders')
        .set(authed(ownerToken))
        .send({ supplierId, lines: [] })
        .expect(422);

      await post('/api/v1/purchase-orders')
        .set(authed(ownerToken))
        .send({
          supplierId,
          lines: [{ productId: product.id, unitCostCents: 1_000 }],
        })
        .expect(422);

      await post('/api/v1/purchase-orders')
        .set(authed(ownerToken))
        .send({
          supplierId,
          lines: [{ productId: product.id, unitCostCents: 1_000, quantity: 0 }],
        })
        .expect(422);
    });
  });

  describe('numbering and listing', () => {
    it('allocates PO-{year}-{seq} and never reuses a number', async () => {
      const product = await makeProduct();
      const first = await createPO([
        { productId: product.id, unitCostCents: 1_000, quantity: 1 },
      ]);
      const second = await createPO([
        { productId: product.id, unitCostCents: 1_000, quantity: 1 },
      ]);

      const year = new Date().getUTCFullYear();
      expect(first.poNumber).toMatch(new RegExp(`^PO-${year}-\\d{3,}$`));
      expect(second.poNumber).not.toBe(first.poNumber);
    });

    it('reports lineCount without the caller loading the lines', async () => {
      const a = await makeProduct();
      const b = await makeProduct();
      const po = await createPO([
        { productId: a.id, unitCostCents: 1_000, quantity: 1 },
        { productId: b.id, unitCostCents: 2_000, quantity: 1 },
      ]);

      const res = await get(
        `/api/v1/purchase-orders?supplierId=${supplierId}&pageSize=100`,
      )
        .set(authed(ownerToken))
        .expect(200);

      const row = bodyOf<PaginatedEnvelope<PurchaseOrderResponse>>(
        res,
      ).data.find((r) => r.id === po.id);
      expect(row?.lineCount).toBe(2);
    });

    it('filters by status', async () => {
      const product = await makeProduct();
      const draft = await createPO([
        { productId: product.id, unitCostCents: 1_000, quantity: 1 },
      ]);
      const sent = await createPO([
        { productId: product.id, unitCostCents: 1_000, quantity: 1 },
      ]);
      await move(sent.id, 'Sent');

      const res = await get(
        `/api/v1/purchase-orders?supplierId=${supplierId}&status=Sent&pageSize=100`,
      )
        .set(authed(ownerToken))
        .expect(200);

      const ids = bodyOf<PaginatedEnvelope<PurchaseOrderResponse>>(
        res,
      ).data.map((r) => r.id);
      expect(ids).toContain(sent.id);
      expect(ids).not.toContain(draft.id);
    });

    it('filters by supplier, excluding another supplier’s POs', async () => {
      const product = await makeProduct();
      const mine = await createPO([
        { productId: product.id, unitCostCents: 1_000, quantity: 1 },
      ]);

      const res = await get(
        `/api/v1/purchase-orders?supplierId=${inactiveSupplierId}&pageSize=100`,
      )
        .set(authed(ownerToken))
        .expect(200);

      const ids = bodyOf<PaginatedEnvelope<PurchaseOrderResponse>>(
        res,
      ).data.map((r) => r.id);
      expect(ids).not.toContain(mine.id);
    });

    it('filters by date range, inclusive of the whole dateTo day', async () => {
      const product = await makeProduct();
      const po = await createPO([
        { productId: product.id, unitCostCents: 1_000, quantity: 1 },
      ]);

      const today = new Date().toISOString().slice(0, 10);
      const res = await get(
        `/api/v1/purchase-orders?supplierId=${supplierId}&dateFrom=${today}&dateTo=${today}&pageSize=100`,
      )
        .set(authed(ownerToken))
        .expect(200);

      const ids = bodyOf<PaginatedEnvelope<PurchaseOrderResponse>>(
        res,
      ).data.map((r) => r.id);
      expect(ids).toContain(po.id);
    });

    it('404s a PO that does not exist and 400s a malformed id', async () => {
      await get(`/api/v1/purchase-orders/${ABSENT_UUID}`)
        .set(authed(ownerToken))
        .expect(404);
      await get('/api/v1/purchase-orders/not-a-uuid')
        .set(authed(ownerToken))
        .expect(400);
    });
  });

  describe('RBAC and the absent routes (BR-03, Section 6.9)', () => {
    it('lets a Manager run the whole cycle', async () => {
      const product = await makeProduct();
      const po = await createPO(
        [{ productId: product.id, unitCostCents: 1_000, quantity: 2 }],
        {},
        managerToken,
      );
      await move(po.id, 'Sent', managerToken);
      expect((await move(po.id, 'Received', managerToken)).status).toBe(
        'Received',
      );
    });

    it('forbids a Cashier every purchases route', async () => {
      const product = await makeProduct();
      const po = await createPO([
        { productId: product.id, unitCostCents: 1_000, quantity: 1 },
      ]);

      await get('/api/v1/purchase-orders')
        .set(authed(cashierToken))
        .expect(403);
      await get(`/api/v1/purchase-orders/${po.id}`)
        .set(authed(cashierToken))
        .expect(403);
      await get(`/api/v1/purchase-orders/${po.id}/transitions`)
        .set(authed(cashierToken))
        .expect(403);
      await post('/api/v1/purchase-orders')
        .set(authed(cashierToken))
        .send({
          supplierId,
          lines: [{ productId: product.id, unitCostCents: 1_000, quantity: 1 }],
        })
        .expect(403);
      await patch(`/api/v1/purchase-orders/${po.id}/status`)
        .set(authed(cashierToken))
        .send({ toStatus: 'Sent' })
        .expect(403);
    });

    it('requires authentication', async () => {
      await get('/api/v1/purchase-orders').expect(401);
      await post('/api/v1/purchase-orders').send({}).expect(401);
    });

    /**
     * 404, not 403. The route is unregistered rather than forbidden, so a client
     * is told the operation does not exist rather than that it exists behind a
     * permission — which is what BR-03 means here. The Owner's `purchases: rwd`
     * grant includes a `delete` that nothing consumes.
     */
    it('registers no DELETE route, even for an Owner', async () => {
      const product = await makeProduct();
      const po = await createPO([
        { productId: product.id, unitCostCents: 1_000, quantity: 1 },
      ]);

      await del(`/api/v1/purchase-orders/${po.id}`)
        .set(authed(ownerToken))
        .expect(404);
    });

    /** No financial PATCH either — money is set once, at POST. */
    it('registers no PATCH /:id, so lines and money cannot be edited', async () => {
      const product = await makeProduct();
      const po = await createPO([
        { productId: product.id, unitCostCents: 1_000, quantity: 1 },
      ]);

      await patch(`/api/v1/purchase-orders/${po.id}`)
        .set(authed(ownerToken))
        .send({ notes: 'edited' })
        .expect(404);
    });
  });
});
