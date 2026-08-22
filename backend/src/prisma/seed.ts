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
  DEV_TENANT_ENABLED_MODULES,
  ROLE_MATRIX,
  flattenRoleMatrix,
} from '../access-control/access-control.constants';
import { PrismaClient } from '../generated/prisma/client';

loadEnv();

const DEV_TENANT_SLUG = 'dev';
const DEV_USER_EMAIL = 'owner@dev.local';
/** Dev-only credential. The database this points at is disposable (C-05). */
const DEV_USER_PASSWORD = 'DevPassw0rd!';

/** Stable key for a permission row, used to diff desired against actual. */
const permissionKey = (module: string, action: string): string =>
  `${module}:${action}`;

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set; cannot seed.');
  }
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
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

    // TenantModuleSubscription is the sole authority for module access (D-03),
    // so this list decides what the dev tenant can reach. The industry modules
    // are intentionally left unsubscribed — see DEV_TENANT_ENABLED_MODULES.
    for (const moduleKey of DEV_TENANT_ENABLED_MODULES) {
      await prisma.tenantModuleSubscription.upsert({
        where: { tenantId_moduleKey: { tenantId: tenant.id, moduleKey } },
        update: { disabledAt: null },
        create: { tenantId: tenant.id, moduleKey },
      });
    }

    // Authoritative in the other direction too: a module previously enabled but
    // no longer on the list is disabled, so re-seeding is deterministic instead
    // of leaving whatever an earlier run happened to switch on.
    const staleSubscriptions = await prisma.tenantModuleSubscription.updateMany(
      {
        where: {
          tenantId: tenant.id,
          moduleKey: { notIn: [...DEV_TENANT_ENABLED_MODULES] },
          disabledAt: null,
        },
        data: { disabledAt: new Date() },
      },
    );

    console.log(
      `Enabled ${DEV_TENANT_ENABLED_MODULES.length} module(s) for tenant ` +
        `"${DEV_TENANT_SLUG}" (${staleSubscriptions.count} disabled).`,
    );

    const ownerRoleId = roleIds.get('Owner');
    if (!ownerRoleId) throw new Error('Owner role was not seeded');

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
