/**
 * Contract test guarding the frontend↔backend taxonomy against silent drift
 * (DEBT-016).
 *
 * Section 4 makes src/config/permissions.ts the canonical source and this
 * backend file its mirror; access-control.constants.ts is transcribed from it by
 * hand. Hand-mirroring can drift, so rather than wait for one layer to enforce a
 * permission the other never intended, this test imports BOTH and asserts they
 * still agree. A divergence fails here instead of reaching production.
 *
 * It deliberately reaches across the project boundary with a relative import.
 * That is only viable because permissions.ts is self-contained (plain string
 * enums, no imports, no path aliases) and because spec files are excluded from
 * `nest build` — so this cross-boundary import is compiled only by ts-jest, which
 * transpiles each file independently and does not enforce the backend's
 * `rootDir`. If that ever stops holding, the honest move is to delete this file
 * and reopen DEBT-016, not to weaken the assertions.
 *
 * The one sanctioned difference is `billing`: Section 6.10 defines billing
 * endpoints, but no billing UI exists, so the frontend `Modules` enum has no
 * BILLING member. That exception is encoded explicitly below — it is allowed for
 * `billing` and nothing else.
 */
import {
  Actions as FrontendActions,
  Modules as FrontendModules,
  DEFAULT_ROLE_PERMISSIONS,
} from '../../../src/config/permissions';
import {
  ACTIONS,
  MODULE_KEYS,
  flattenRoleMatrix,
} from './access-control.constants';

/** The only module key permitted to exist on the backend but not the frontend. */
const BACKEND_ONLY_MODULES = ['billing'] as const;

const frontendModuleValues = Object.values(FrontendModules);
const frontendActionValues = Object.values(FrontendActions);

/** Flattens the frontend matrix into `role|module|action` strings. */
function flattenFrontendGrants(): string[] {
  const grants: string[] = [];
  for (const [roleName, moduleGrants] of Object.entries(
    DEFAULT_ROLE_PERMISSIONS,
  )) {
    for (const [moduleKey, actions] of Object.entries(moduleGrants)) {
      for (const action of actions ?? []) {
        grants.push(`${roleName}|${moduleKey}|${action}`);
      }
    }
  }
  return grants;
}

describe('module taxonomy contract (frontend ↔ backend)', () => {
  describe('actions', () => {
    it('are exactly the same set on both sides', () => {
      expect([...ACTIONS].sort()).toEqual([...frontendActionValues].sort());
    });
  });

  describe('modules', () => {
    it('includes every frontend module in the backend list', () => {
      for (const moduleKey of frontendModuleValues) {
        expect(MODULE_KEYS).toContain(moduleKey);
      }
    });

    it('adds nothing beyond the frontend list except the sanctioned billing key', () => {
      const backendOnly = MODULE_KEYS.filter(
        (moduleKey) =>
          !(frontendModuleValues as string[]).includes(moduleKey),
      );
      // Exactly `['billing']` — a new backend-only key must be a deliberate
      // decision recorded here, not something that quietly appears.
      expect(backendOnly.sort()).toEqual([...BACKEND_ONLY_MODULES].sort());
    });

    it('keeps the frontend enum free of the backend-only keys', () => {
      for (const moduleKey of BACKEND_ONLY_MODULES) {
        expect(frontendModuleValues as string[]).not.toContain(moduleKey);
      }
    });
  });

  describe('role grants', () => {
    const frontendGrants = new Set(flattenFrontendGrants());
    const backendGrants = flattenRoleMatrix().map(
      (triple) => `${triple.roleName}|${triple.module}|${triple.action}`,
    );

    it('match cell-for-cell for every shared (non-billing) module', () => {
      const backendShared = backendGrants
        .filter((grant) => !grant.includes('|billing|'))
        .sort();
      expect(backendShared).toEqual([...frontendGrants].sort());
    });

    it('grants the backend-only billing module to Owner alone', () => {
      // billing has no frontend row to reconcile against; the backend's inferred
      // "Owner only" stance (see access-control.constants.ts) is pinned here so a
      // future edit that widens it is caught. Flagged for confirmation in
      // DEBT-016.
      const billingGrants = backendGrants.filter((grant) =>
        grant.includes('|billing|'),
      );
      expect(billingGrants.length).toBeGreaterThan(0);
      for (const grant of billingGrants) {
        expect(grant.startsWith('Owner|')).toBe(true);
      }
    });
  });
});
