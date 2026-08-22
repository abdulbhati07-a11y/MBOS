import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  NO_MODULE_REQUIRED_KEY,
  PermissionRequirement,
  REQUIRES_PERMISSION_KEY,
} from '../../access-control/access-control.decorators';
import { ModuleAccessGuard } from '../../access-control/module-access.guard';
import { PermissionGuard } from '../../access-control/permission.guard';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RateLimitGuard } from '../../rate-limit/rate-limit.guard';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * The whole middleware chain of Section 6.2, in one guard, in order.
 *
 * WHY ONE GUARD INSTEAD OF FOUR GLOBAL ONES
 *
 * The order of these steps is a security property, not a stylistic choice:
 *   - rate limiting must precede authentication, or a flood of bad passwords
 *     costs a bcrypt comparison and a database round trip each;
 *   - module access and permission checks must follow authentication, because
 *     both read tenantId/roleId that only step 3 can supply.
 *
 * Registering four separate APP_GUARD providers would leave that ordering
 * implicit in how Nest resolves providers across modules — invisible in the code
 * and able to change under a refactor. Sequencing them here makes the chain
 * readable in one place and reviewable against the doc. Each collaborator stays
 * an independently unit-testable class, and each also re-checks its own
 * preconditions, so a future caller that invokes them out of order fails closed
 * rather than silently skipping a check.
 *
 * Chain coverage: step 1 (CORS/Helmet) is applied in main.ts, step 4's storage
 * scope is opened by TenantContextMiddleware, and step 8 is the Prisma extension.
 * Steps 2, 3, 5 and 6 are here.
 */
@Injectable()
export class ApiAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimit: RateLimitGuard,
    private readonly jwtAuth: JwtAuthGuard,
    private readonly moduleAccess: ModuleAccessGuard,
    private readonly permissions: PermissionGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // ---- Step 2a: per-IP rate limit -------------------------------------
    // Before anything else, including on @Public routes. This is the half of
    // step 2 that can run "before authentication" as Section 6.2 specifies.
    this.rateLimit.checkIp(context);

    // ---- Public routes skip steps 3-6 (Section 6.2) ----------------------
    if (this.metadataFlag(context, IS_PUBLIC_KEY)) {
      return true;
    }

    // ---- Steps 3 and 4: authenticate, bind tenant context ---------------
    await this.jwtAuth.canActivate(context);

    // ---- Step 2b: per-tenant rate limit ---------------------------------
    // Necessarily after step 3: the key is the JWT's tenantId (see DEBT-017).
    this.rateLimit.checkTenant();

    // ---- Routes with no business module ---------------------------------
    if (this.metadataFlag(context, NO_MODULE_REQUIRED_KEY)) {
      return true;
    }

    const requirement = this.reflector.getAllAndOverride<PermissionRequirement>(
      REQUIRES_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requirement) {
      // FAIL CLOSED. An authenticated route that declares neither a permission
      // nor @NoModuleRequired() is a route whose author has not said who may
      // call it, so it is refused. Fail-open would turn every forgotten
      // decorator into an unguarded endpoint; this turns it into a 403 that the
      // route's own test catches immediately. Not in Section 6.2 — DEBT-017.
      throw new ForbiddenException(
        'This endpoint declares no access requirements.',
      );
    }

    // ---- Steps 5 and 6: module subscription, then role permission -------
    // Run concurrently: they are independent lookups and both must pass, so
    // there is nothing to gain from serialising two round trips. Promise.all
    // rejects with whichever fails first, and either failure is a 403.
    await Promise.all([
      this.moduleAccess.assertModuleEnabled(requirement.module),
      this.permissions.assertPermission(requirement),
    ]);

    return true;
  }

  private metadataFlag(context: ExecutionContext, key: string): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(key, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false
    );
  }
}
