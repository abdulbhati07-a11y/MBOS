/**
 * Seeds the built-in roles and a single development tenant.
 *
 * Prisma v7 no longer runs a seed automatically after `migrate dev`, so this is
 * invoked explicitly: `npm run db:seed`, which compiles first and runs the
 * emitted JavaScript. It lives under src/ for that reason — the generated
 * client's own sources use ESM-style `./x.js` specifiers that ts-node cannot
 * resolve against its `.ts` files, while the compiled output resolves cleanly.
 *
 * Everything here is idempotent (upserts keyed on the natural unique columns),
 * so re-running after a schema change is safe. It writes on the raw client, not
 * PrismaService.db — there is no request and therefore no tenant context.
 *
 * The permission matrix and module list are NOT defined here: they live in
 * ../access-control/access-control.constants.ts, which the permission and
 * module-access guards read from too, so enforcement and seed data cannot
 * disagree.
 *
 * This seed is *authoritative*, not merely additive. For the three built-in
 * roles it both inserts what the canonical matrix grants and deletes what it
 * does not — an upsert-only seed can never revoke a permission, and the database
 * currently holds surplus grants from before the matrix was reconciled (see the
 * header of access-control.constants.ts). Custom roles (DEBT-007) are tenant
 * data and are never touched.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { hash } from 'bcryptjs';
import { config as loadEnv } from 'dotenv';
import {
  DEV_TENANT_ENABLED_INDUSTRY_MODULES,
  DEV_TENANT_PLAN_NAME,
  ROLE_MATRIX,
  SEED_PLANS,
  flattenRoleMatrix,
} from '../access-control/access-control.constants';
import { PrismaClient } from '../generated/prisma/client';
import { buildPgConfig } from './pg-config';

loadEnv();

const DEV_TENANT_SLUG = 'dev';
const DEV_USER_EMAIL = 'owner@dev.local';
/** Dev-only credential. The database this points at is disposable (C-05). */
const DEV_USER_PASSWORD = 'DevPassw0rd!';

/** Stable key for a permission row, used to diff desired against actual. */
const permissionKey = (module: string, action: string): string =>
  `${module}:${action}`;

async function main(): Promise<void> {
  // Same pg/TLS config as the Nest runtime — DATABASE_URL plus the optional
  // pinned CA from DATABASE_CA_CERT_PATH. See prisma/pg-config.ts.
  const prisma = new PrismaClient({
    adapter: new PrismaPg(buildPgConfig()),
  });

  try {
    const roleIds = new Map<string, string>();
    const triples = flattenRoleMatrix();

    for (const roleName of Object.keys(ROLE_MATRIX)) {
      // Global built-ins have tenantId = null (Section 5.3). A compound unique
      // containing NULL never matches in SQL, so upsert cannot target it —
      // hence find-then-create rather than a single statement.
      const role =
        (await prisma.role.findFirst({
          where: { tenantId: null, name: roleName },
        })) ??
        (await prisma.role.create({
          data: { name: roleName, isBuiltIn: true },
        }));
      roleIds.set(roleName, role.id);
    }

    for (const { roleName, module, action } of triples) {
      const roleId = roleIds.get(roleName);
      if (!roleId) throw new Error(`Role ${roleName} was not seeded`);

      await prisma.rolePermission.upsert({
        where: { roleId_module_action: { roleId, module, action } },
        update: { granted: true },
        create: { roleId, module, action, granted: true },
      });
    }

    // Prune. Anything present for a built-in role but absent from the canonical
    // matrix is a grant the spec does not allow, so it must go rather than be
    // left for the permission guard to honour.
    let pruned = 0;
    for (const [roleName, roleId] of roleIds) {
      const desired = new Set(
        triples
          .filter((triple) => triple.roleName === roleName)
          .map((triple) => permissionKey(triple.module, triple.action)),
      );

      const existing = await prisma.rolePermission.findMany({
        where: { roleId },
        select: { id: true, module: true, action: true },
      });
      const surplusIds = existing
        .filter((row) => !desired.has(permissionKey(row.module, row.action)))
        .map((row) => row.id);

      if (surplusIds.length > 0) {
        await prisma.rolePermission.deleteMany({
          where: { id: { in: surplusIds } },
        });
        pruned += surplusIds.length;
        console.log(
          `Pruned ${surplusIds.length} non-canonical permission(s) from ${roleName}.`,
        );
      }
    }

    console.log(
      `Seeded ${roleIds.size} built-in roles with ${triples.length} ` +
        `permissions (${pruned} pruned).`,
    );

    // The dev tenant, its subscription and its known-password owner are
    // development scaffolding. They must never exist in a production database:
    // `DevPassw0rd!` is public (it is in this repository), so an unconditional
    // seed would hand every deployment a live Owner login. NODE_ENV gates it
    // automatically; SEED_DEV_TENANT=false opts out in shared dev/staging too.
    // Everything above (roles, permissions) and below (plans) is global
    // catalogue data and still seeds unconditionally.
    const seedDevTenant =
      process.env.NODE_ENV !== 'production' &&
      process.env.SEED_DEV_TENANT !== 'false';

    if (!seedDevTenant) {
      console.log(
        'Skipping dev tenant / dev user seed ' +
          `(NODE_ENV=${process.env.NODE_ENV ?? 'unset'}` +
          `${process.env.SEED_DEV_TENANT === 'false' ? ', SEED_DEV_TENANT=false' : ''}).`,
      );
      return;
    }

    const tenant = await prisma.tenant.upsert({
      where: { slug: DEV_TENANT_SLUG },
      update: {},
      create: { name: 'Dev Tenant', slug: DEV_TENANT_SLUG, status: 'Active' },
    });

    await prisma.tenantSettings.upsert({
      where: { tenantId: tenant.id },
      update: {},
      create: { tenantId: tenant.id, companyName: 'Dev Tenant' },
    });

    const existingDefaultBranch = await prisma.branch.findFirst({
      where: { tenantId: tenant.id, isDefault: true },
    });
    if (!existingDefaultBranch) {
      // The partial unique index in 20260821150000_add_constraints allows only
      // one default branch per tenant, so this is a find-then-create.
      await prisma.branch.create({
        data: { tenantId: tenant.id, name: 'Main Branch', isDefault: true },
      });
    }

    // TenantModuleSubscription holds a row ONLY for an industry module
    // (DEBT-016): core modules are RBAC-only, always available, and must never
    // appear in this table — the module-access guard treats a core key as
    // allowed without ever looking here. So the seed is authoritative by
    // physical presence, not by a disabledAt flag: it deletes every row for the
    // tenant, then recreates one per subscribed industry module. A core row left
    // behind by an older seed (which used to enable dashboard/inventory/… here)
    // is therefore removed outright rather than merely disabled.
    await prisma.tenantModuleSubscription.deleteMany({
      where: { tenantId: tenant.id },
    });
    for (const moduleKey of DEV_TENANT_ENABLED_INDUSTRY_MODULES) {
      await prisma.tenantModuleSubscription.create({
        data: { tenantId: tenant.id, moduleKey },
      });
    }

    console.log(
      `Reset module subscriptions for tenant "${DEV_TENANT_SLUG}": ` +
        `${DEV_TENANT_ENABLED_INDUSTRY_MODULES.length} industry module(s) ` +
        'subscribed, all core rows removed.',
    );

    const ownerRoleId = roleIds.get('Owner');
    if (!ownerRoleId) throw new Error('Owner role was not seeded');

    // Plan catalogue (Section 6.10 GET /plans). Global, not tenant data, and
    // there is no endpoint that creates plans — Section 6.13 puts plan CRUD in
    // the Section 10 super-tenant API — so the seed is the only source.
    const planIds = new Map<string, string>();
    for (const plan of SEED_PLANS) {
      const record = await prisma.plan.upsert({
        where: { name: plan.name },
        update: {
          description: plan.description,
          priceMonthly: plan.priceMonthlyCents,
          priceAnnual: plan.priceAnnualCents,
          isActive: true,
        },
        create: {
          name: plan.name,
          description: plan.description,
          priceMonthly: plan.priceMonthlyCents,
          priceAnnual: plan.priceAnnualCents,
        },
      });
      planIds.set(plan.name, record.id);

      for (const moduleKey of plan.modules) {
        await prisma.planModule.upsert({
          where: {
            planId_moduleKey: { planId: record.id, moduleKey },
          },
          update: {},
          create: { planId: record.id, moduleKey },
        });
      }
      // Authoritative: a module dropped from a plan's definition must not linger.
      await prisma.planModule.deleteMany({
        where: { planId: record.id, moduleKey: { notIn: [...plan.modules] } },
      });
    }
    console.log(`Seeded ${SEED_PLANS.length} plans with their module lists.`);

    // A billing record for the dev tenant, so GET /billing/subscription returns
    // real data. Has no effect on module access — TenantModuleSubscription owns
    // that (D-03), which is exactly what this row must not be confused with.
    const devPlanId = planIds.get(DEV_TENANT_PLAN_NAME);
    if (!devPlanId) {
      throw new Error(`Plan ${DEV_TENANT_PLAN_NAME} was not seeded`);
    }
    const periodStart = new Date(Date.UTC(2026, 7, 1));
    const periodEnd = new Date(Date.UTC(2026, 7, 31, 23, 59, 59));
    await prisma.tenantSubscription.upsert({
      where: { tenantId: tenant.id },
      update: { planId: devPlanId, status: 'Active' },
      create: {
        tenantId: tenant.id,
        planId: devPlanId,
        status: 'Active',
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
      },
    });
    console.log(
      `Subscribed tenant "${DEV_TENANT_SLUG}" to the ${DEV_TENANT_PLAN_NAME} plan.`,
    );

    await prisma.user.upsert({
      where: { tenantId_email: { tenantId: tenant.id, email: DEV_USER_EMAIL } },
      update: { roleId: ownerRoleId, isActive: true, deletedAt: null },
      create: {
        tenantId: tenant.id,
        email: DEV_USER_EMAIL,
        passwordHash: await hash(DEV_USER_PASSWORD, 12),
        roleId: ownerRoleId,
      },
    });

    console.log(
      `Seeded tenant "${DEV_TENANT_SLUG}" with owner ${DEV_USER_EMAIL}.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
