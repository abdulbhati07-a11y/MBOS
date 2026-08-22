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
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { hash } from 'bcryptjs';
import { config as loadEnv } from 'dotenv';
import { PrismaClient } from '../generated/prisma/client';

loadEnv();

/** Matches the frontend Modules enum. */
const MODULES = [
  'sales',
  'inventory',
  'customers',
  'purchases',
  'reports',
  'settings',
  'billing',
] as const;

type Action = 'read' | 'write' | 'delete' | 'refund';

/**
 * Backend of DEFAULT_ROLE_PERMISSIONS (Section 5.3). Owner is unrestricted;
 * Manager runs operations but cannot touch billing; Cashier is point-of-sale
 * only and cannot issue refunds (BR-03 requires `sales.refund`).
 */
const ROLE_MATRIX: Record<string, Partial<Record<string, Action[]>>> = {
  Owner: Object.fromEntries(
    MODULES.map((m) => [m, ['read', 'write', 'delete', 'refund'] as Action[]]),
  ),
  Manager: {
    sales: ['read', 'write', 'refund'],
    inventory: ['read', 'write', 'delete'],
    customers: ['read', 'write', 'delete'],
    purchases: ['read', 'write', 'delete'],
    reports: ['read'],
    settings: ['read', 'write'],
  },
  Cashier: {
    sales: ['read', 'write'],
    inventory: ['read'],
    customers: ['read', 'write'],
    reports: ['read'],
  },
};

const DEV_TENANT_SLUG = 'dev';
const DEV_USER_EMAIL = 'owner@dev.local';
/** Dev-only credential. The database this points at is disposable (C-05). */
const DEV_USER_PASSWORD = 'DevPassw0rd!';

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

    for (const [roleName, grants] of Object.entries(ROLE_MATRIX)) {
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

      for (const [moduleKey, actions] of Object.entries(grants)) {
        for (const action of actions ?? []) {
          await prisma.rolePermission.upsert({
            where: {
              roleId_module_action: {
                roleId: role.id,
                module: moduleKey,
                action,
              },
            },
            update: { granted: true },
            create: {
              roleId: role.id,
              module: moduleKey,
              action,
              granted: true,
            },
          });
        }
      }
    }
    console.log(`Seeded ${roleIds.size} built-in roles with permissions.`);

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

    // Every module enabled: TenantModuleSubscription is the sole authority for
    // module access (D-03), so an empty set would 403 every route.
    for (const moduleKey of MODULES) {
      await prisma.tenantModuleSubscription.upsert({
        where: { tenantId_moduleKey: { tenantId: tenant.id, moduleKey } },
        update: { disabledAt: null },
        create: { tenantId: tenant.id, moduleKey },
      });
    }

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
