import { SetMetadata } from '@nestjs/common';
import { Action, ModuleKey } from './access-control.constants';

/** Metadata key holding the (module, action) a route requires. */
export const REQUIRES_PERMISSION_KEY = 'mbos:requiresPermission';

/** Metadata key marking a route as belonging to no business module. */
export const NO_MODULE_REQUIRED_KEY = 'mbos:noModuleRequired';

export interface PermissionRequirement {
  module: ModuleKey;
  action: Action;
}

/**
 * Declares what a route requires, feeding BOTH remaining chain steps: step 5
 * reads `module` to check the tenant's subscription, step 6 reads `(module,
 * action)` to check the role's permission.
 *
 * One decorator drives two checks because they are always declared together, but
 * they remain genuinely separate gates — Section 6.2's "Key constraint" applies:
 * a tenant may have the Sales module enabled while a particular user still lacks
 * `sales.refund`, and a user may hold `sales.refund` while their tenant has no
 * Sales subscription. Either one failing is a 403.
 *
 *   @RequiresPermission('sales', 'refund')
 */
export const RequiresPermission = (module: ModuleKey, action: Action) =>
  SetMetadata(REQUIRES_PERMISSION_KEY, { module, action });

/**
 * Marks an authenticated route that belongs to no business module, so steps 5
 * and 6 are skipped while authentication still applies.
 *
 * This exists because the access check fails CLOSED: an authenticated route with
 * no metadata at all is rejected, so that forgetting a decorator on a future
 * endpoint is a loud failure instead of an unguarded hole. A handful of routes
 * legitimately have no module — `GET /auth/me` returns the caller's own identity
 * and is what the frontend uses to discover its permissions in the first place,
 * so gating it on a permission would be circular.
 *
 * Not a synonym for @Public(): the caller must still present a valid token.
 *
 * Section 6.2 does not describe this exemption; it is an implementation
 * decision, recorded in DEBT-017.
 */
export const NoModuleRequired = () => SetMetadata(NO_MODULE_REQUIRED_KEY, true);
