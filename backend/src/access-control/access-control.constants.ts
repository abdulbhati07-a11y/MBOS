/**
 * The canonical access-control taxonomy: module keys, actions, and the built-in
 * role matrix.
 *
 * Section 5.3 states that `RolePermission.module`/`.action` values "match the
 * `Modules` and `Actions` TypeScript enums exactly", and Section 4 (lines
 * 158-173) states that the frontend's `DEFAULT_ROLE_PERMISSIONS` *becomes* the
 * seed data for the `RolePermission` table — the TypeScript constant being "the
 * frontend's optimistic cache of this data". That makes
 * `src/config/permissions.ts` the canonical source and this file its backend
 * mirror.
 *
 * ROLE_MATRIX below is therefore transcribed cell-for-cell from
 * `src/config/permissions.ts` (DEFAULT_ROLE_PERMISSIONS). It is deliberately
 * *not* a superset: before this file existed the seed granted Manager
 * `settings.write`, Manager `delete` on three modules, Cashier `customers.write`
 * and Cashier `reports.read` — none of which the canonical matrix allows. Those
 * surplus grants were inert while nothing read the table, but the permission
 * guard makes them live authorization, so they are removed here and pruned from
 * the database by the seed (see prisma/seed.ts).
 *
 * Mirroring by hand is itself a hazard — the two files can drift again silently.
 * Until the taxonomy lives in one shared source both layers import (a monorepo
 * change tracked in DEBT-016), `module-taxonomy.contract.spec.ts` asserts that
 * this list and the frontend `Modules` enum still agree, so drift fails a test
 * rather than reaching production. `billing` is the one key that exists only on
 * this side (there is no billing UI yet), and the contract test encodes exactly
 * that exception.
 *
 * Module keys split into two classes with different gating (DEBT-016/DEBT-018):
 * core modules are always available and gated by RBAC only, industry modules are
 * the only ones that go through TenantModuleSubscription. See INDUSTRY_MODULE_KEYS.
 */

/**
 * Every module the API recognises.
 *
 * The first ten are the frontend `Modules` enum verbatim. `billing` is
 * backend-only: Section 6.10 defines billing endpoints, but the frontend enum
 * has no `BILLING` member because no billing UI exists yet (DEBT-016).
 */
export const MODULE_KEYS = [
  'dashboard',
  'inventory',
  'sales',
  'customers',
  'purchases',
  'reports',
  'settings',
  'clinic',
  'pharmacy',
  'restaurant',
  'billing',
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

/**
 * Industry modules — the ONLY modules that are subscription-gated (DEBT-016).
 *
 * The product decision: a tenant subscribes to, and can be charged for, the
 * vertical add-ons only. `TenantModuleSubscription` therefore holds a row for an
 * industry module and never for a core one — the module-access guard consults
 * the table for these keys and short-circuits to "allowed" for every other key.
 *
 * These three are named explicitly rather than derived, because "which modules
 * cost extra" is a product statement, not something to infer. A future vertical
 * (e.g. `salon`) becomes gated by being added here.
 */
export const INDUSTRY_MODULE_KEYS = [
  'clinic',
  'pharmacy',
  'restaurant',
] as const satisfies readonly ModuleKey[];

/**
 * Core modules — everything that is not an industry add-on. Gated by RBAC only
 * (the role→permission matrix), never by a subscription row: a tenant always has
 * them, so there is no `TenantModuleSubscription` row for a core module, ever
 * (DEBT-016, DEBT-018). Derived from MODULE_KEYS so a newly added key is core —
 * i.e. always available — unless it is deliberately listed as industry above.
 */
export const CORE_MODULE_KEYS = MODULE_KEYS.filter(
  (moduleKey): moduleKey is ModuleKey =>
    !INDUSTRY_MODULE_KEYS.includes(moduleKey as (typeof INDUSTRY_MODULE_KEYS)[number]),
);

/**
 * Whether a module is subscription-gated (industry) rather than always-on
 * (core). The single predicate both the module-access guard and the billing
 * service branch on, so "core is RBAC-only, industry goes through
 * TenantModuleSubscription" is stated in exactly one place.
 */
export function isIndustryModule(moduleKey: ModuleKey): boolean {
  return (INDUSTRY_MODULE_KEYS as readonly ModuleKey[]).includes(moduleKey);
}

/**
 * The frontend `Actions` enum verbatim. `refund` is Sales-scoped and separate
 * from `delete` on purpose: per BR-03 a refund is a reversing transaction, not a
 * destructive edit, so it can be granted or revoked independently (Section 6.6
 * requires `sales.refund` specifically, never `sales.write`).
 */
export const ACTIONS = ['read', 'write', 'delete', 'refund'] as const;

export type Action = (typeof ACTIONS)[number];

/** Shorthands matching the legend in src/config/permissions.ts. */
const r: readonly Action[] = ['read'];
const rw: readonly Action[] = ['read', 'write'];
const rwd: readonly Action[] = ['read', 'write', 'delete'];
const rwrf: readonly Action[] = ['read', 'write', 'refund'];
const rwdrf: readonly Action[] = ['read', 'write', 'delete', 'refund'];

export type RoleGrants = Partial<Record<ModuleKey, readonly Action[]>>;

/**
 * The three built-in roles (Section 5.3: `tenantId = null`, `isBuiltIn = true`).
 *
 * A module absent from a role's grants means no access at all — Cashier has no
 * `purchases`, `reports` or `settings` entry, so every action on those is
 * denied. Custom roles (DEBT-007) are stored per tenant and are not seeded here.
 *
 * `billing` is granted to Owner only. That is an inference, not a documented
 * rule: Section 6.10 gives no required permission for its endpoints, and the
 * frontend matrix has no `billing` row at all. It follows the existing seed's
 * stated intent ("Manager runs operations but cannot touch billing") and is
 * flagged in DEBT-016 for confirmation.
 */
export const ROLE_MATRIX: Readonly<Record<string, RoleGrants>> = {
  Owner: {
    dashboard: r,
    inventory: rwd,
    sales: rwdrf,
    customers: rwd,
    purchases: rwd,
    reports: rwd,
    settings: rwd,
    clinic: rwd,
    pharmacy: rwd,
    restaurant: rwd,
    billing: rwd,
  },
  Manager: {
    dashboard: r,
    inventory: rw,
    sales: rwrf,
    customers: rw,
    purchases: rw,
    reports: r,
    settings: r,
    clinic: rw,
    pharmacy: rw,
    restaurant: rw,
  },
  Cashier: {
    dashboard: r,
    inventory: r,
    sales: rw,
    customers: r,
    clinic: r,
    pharmacy: r,
    restaurant: r,
  },
};

/**
 * Industry modules the development tenant subscribes to — deliberately none.
 *
 * Only industry modules are ever present in `TenantModuleSubscription`
 * (DEBT-016). Leaving all three unsubscribed keeps a genuinely gated module for
 * the module-access guard's 403 path to be tested against, without mutating
 * subscription rows mid-test or writing business data into the shared dev
 * database (C-05). Core modules are RBAC-only and never appear in the table at
 * all, so they are not listed here — the seed removes any core row a previous
 * run may have written. Add an industry key here to switch it on for dev.
 */
export const DEV_TENANT_ENABLED_INDUSTRY_MODULES: readonly ModuleKey[] = [];

/** One (roleName, module, action) triple per granted permission. */
export interface PermissionTriple {
  roleName: string;
  module: ModuleKey;
  action: Action;
}

/**
 * Every (module, action) pair that can meaningfully be granted — the grid a
 * permissions editor renders and `GET /roles/:id/permissions` enumerates.
 *
 * `refund` is deliberately Sales-only. Per BR-03 a refund is a reversing
 * financial transaction, which exists for orders and nowhere else, so
 * `inventory.refund` is not a permission a tenant has merely denied — it is not a
 * permission at all. Emitting it as `granted: false` would invite a UI to render a
 * checkbox that can never mean anything.
 */
export const PERMISSION_GRID: readonly {
  module: ModuleKey;
  action: Action;
}[] = MODULE_KEYS.flatMap((module) =>
  ACTIONS.filter((action) => action !== 'refund' || module === 'sales').map(
    (action) => ({ module, action }),
  ),
);

/**
 * The plan catalogue, seeded as development scaffolding.
 *
 * Values are taken from the Section 6.10 `GET /plans` example verbatim rather
 * than invented (Starter at 1900 cents, Growth at 4900, with those exact module
 * lists). Plans are global — not tenant data — and Section 6.13 assigns plan
 * CRUD to the super-tenant admin API in Section 10, so there is no endpoint that
 * creates them; seeding is the only way they exist for development.
 *
 * `modules` here is informational: it describes what a plan includes at
 * onboarding. It never grants access — TenantModuleSubscription is the sole
 * authority for that (D-03).
 */
export const SEED_PLANS: readonly {
  name: string;
  description: string;
  priceMonthlyCents: number;
  priceAnnualCents: number;
  modules: readonly ModuleKey[];
}[] = [
  {
    name: 'Starter',
    description: 'Core retail operations for a single location.',
    priceMonthlyCents: 1900,
    // Ten months for the price of twelve, the usual annual discount shape.
    priceAnnualCents: 19_000,
    modules: ['dashboard', 'inventory', 'sales', 'customers'],
  },
  {
    name: 'Growth',
    description: 'Adds purchasing, reporting and configuration.',
    priceMonthlyCents: 4900,
    priceAnnualCents: 49_000,
    modules: [
      'dashboard',
      'inventory',
      'sales',
      'customers',
      'purchases',
      'reports',
      'settings',
      'billing',
    ],
  },
];

/** Which plan the development tenant is subscribed to. */
export const DEV_TENANT_PLAN_NAME = 'Growth';

/**
 * Flattens ROLE_MATRIX into the rows `RolePermission` stores. The seed uses this
 * both to upsert what should exist and to recognise what should not.
 */
export function flattenRoleMatrix(): PermissionTriple[] {
  const triples: PermissionTriple[] = [];
  for (const [roleName, grants] of Object.entries(ROLE_MATRIX)) {
    for (const [moduleKey, actions] of Object.entries(grants)) {
      for (const action of actions ?? []) {
        triples.push({
          roleName,
          module: moduleKey as ModuleKey,
          action,
        });
      }
    }
  }
  return triples;
}
