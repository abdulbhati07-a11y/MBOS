import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../generated/prisma/client';
import { PrismaModule } from './prisma.module';
import { PrismaService } from './prisma.service';
import { TenancyModule } from '../tenancy/tenancy.module';
import { TenantContextService } from '../tenancy/tenant-context.service';

/**
 * Integration test for row-level tenant isolation (Section 4.3). Runs against
 * the ephemeral e2e database (`npm run test:e2e:local`). Every row it creates is
 * removed in afterAll; test/guard-database.ts guarantees the target is
 * disposable in the first place (C-05).
 */
describe('tenant scope extension', () => {
  let prisma: PrismaService;
  let context: TenantContextService;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const sku = `TEST-${randomUUID().slice(0, 8)}`;

  const asTenant = <T>(tenantId: string, fn: () => Promise<T>): Promise<T> =>
    context.run(
      { tenantId, userId: randomUUID(), roleId: randomUUID(), role: 'Owner' },
      fn,
    );

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
        TenancyModule,
        PrismaModule,
      ],
    }).compile();
    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    context = moduleRef.get(TenantContextService);

    // Tenants are created on the unscoped client: Tenant is the isolation
    // root, so it is intentionally outside the extension's scope set.
    await prisma.tenant.createMany({
      data: [
        { id: tenantA, name: 'Tenant A', slug: `a-${tenantA.slice(0, 8)}` },
        { id: tenantB, name: 'Tenant B', slug: `b-${tenantB.slice(0, 8)}` },
      ],
    });
  }, 30_000);

  afterAll(async () => {
    await prisma.product.deleteMany({
      where: { tenantId: { in: [tenantA, tenantB] } },
    });
    await prisma.tenant.deleteMany({
      where: { id: { in: [tenantA, tenantB] } },
    });
    await prisma.$disconnect();
  }, 30_000);

  it('stamps tenantId on create without the caller passing it', async () => {
    const product = await asTenant(tenantA, () =>
      prisma.db.product.create({
        // Omitting `tenant`/`tenantId` is the point of the test, so the input is
        // asserted for the same reason the services assert theirs: the generated
        // type demands the relation, and the extension is what supplies it. If
        // this assertion were removed the test would not compile, which would
        // hide the very behaviour it exists to prove.
        data: {
          name: 'Scoped Widget',
          sku,
          priceCents: 1_500,
        } as Prisma.ProductUncheckedCreateInput,
      }),
    );
    expect(product.tenantId).toBe(tenantA);
  });

  it('hides another tenant rows from findMany', async () => {
    const [seenByA, seenByB] = await Promise.all([
      asTenant(tenantA, () => prisma.db.product.findMany({ where: { sku } })),
      asTenant(tenantB, () => prisma.db.product.findMany({ where: { sku } })),
    ]);
    expect(seenByA).toHaveLength(1);
    expect(seenByB).toHaveLength(0);
  });

  it('returns null when another tenant looks the row up by primary key', async () => {
    const owned = await asTenant(tenantA, () =>
      prisma.db.product.findFirst({ where: { sku } }),
    );
    expect(owned).not.toBeNull();

    const stolen = await asTenant(tenantB, () =>
      prisma.db.product.findUnique({ where: { id: owned!.id } }),
    );
    expect(stolen).toBeNull();
  });

  it('refuses to update a row belonging to another tenant', async () => {
    const affected = await asTenant(tenantB, () =>
      prisma.db.product.updateMany({
        where: { sku },
        data: { priceCents: 1 },
      }),
    );
    expect(affected.count).toBe(0);

    const unchanged = await asTenant(tenantA, () =>
      prisma.db.product.findFirst({ where: { sku } }),
    );
    expect(unchanged?.priceCents).toBe(1_500);
  });

  it('fails closed when there is no tenant context', async () => {
    await expect(prisma.db.product.findMany()).rejects.toThrow(
      /Tenant context missing/,
    );
  });

  it('leaves unscoped models reachable without context', async () => {
    await expect(
      prisma.db.tenant.findUnique({ where: { id: tenantA } }),
    ).resolves.toMatchObject({ id: tenantA });
  });
});
