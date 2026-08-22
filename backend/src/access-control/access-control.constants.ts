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
 * DEBT-016 records that this list should be generated from the frontend enum
 * rather than duplicated, and that `billing` currently exists only on this side.
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
 * Modules the development tenant subscribes to.
 *
 * The industry modules (clinic/pharmacy/restaurant) are deliberately excluded.
 * `TenantModuleSubscription` is the sole authority for module access (D-03) and
 * an absent row means "not enabled", so this leaves a genuinely unsubscribed
 * module for the module-access guard's 403 path to be tested against — without
 * mutating subscription rows mid-test and without writing business data into the
 * shared dev database (C-05).
 */
export const DEV_TENANT_ENABLED_MODULES: readonly ModuleKey[] = [
  'dashboard',
  'inventory',
  'sales',
  'customers',
  'purchases',
  'reports',
  'settings',
  'billing',
];

/** One (roleName, module, action) triple per granted permission. */
export interface PermissionTriple {
  roleName: string;
  module: ModuleKey;
  action: Action;
}

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
