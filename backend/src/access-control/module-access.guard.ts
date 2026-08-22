import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { ModuleKey } from './access-control.constants';

/**
 * Step 5 of the middleware chain (Section 6.2) — module access, FR-BILL-03.
 *
 * `TenantModuleSubscription` is the sole authority for whether a module is
 * available to a tenant (D-03); `Plan` and `PlanModule` are billing convenience
 * and are never consulted here. A module is enabled only if a row exists AND its
 * `disabledAt` is null.
 *
 * The check runs on every request rather than being cached or resolved at login,
 * because FR-BILL-03 requires exactly that and UC-04 requires a disable to take
 * effect immediately with no redeployment. A cache with any TTL would leave a
 * cancelled module reachable for the length of that TTL.
 */
@Injectable()
export class ModuleAccessGuard {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async assertModuleEnabled(moduleKey: ModuleKey): Promise<void> {
    // Defence in depth: this guard is invoked by ApiAccessGuard after the auth
    // guard has bound the context. If it ever runs earlier, fail loudly rather
    // than querying without a tenant.
    if (!this.tenantContext.getTenantId()) {
      throw new Error(
        'ModuleAccessGuard ran before the tenant context was bound. It must ' +
          'be invoked after the auth guard (chain steps 3-4).',
      );
    }

    // The tenant-scoped client: TenantModuleSubscription is in SCOPED_MODELS, so
    // the Prisma extension injects `tenantId` into this `where` clause. That is
    // why tenantId is not passed explicitly — the extension owns it, and a
    // caller cannot widen the query to another tenant.
    //
    // findFirst, not findUnique, is deliberate: the extension spreads `tenantId`
    // at the top level of `where`, which would collide with the
    // `tenantId_moduleKey` compound-unique input shape. @@unique([tenantId,
    // moduleKey]) already guarantees at most one row matches.
    const subscription =
      await this.prisma.db.tenantModuleSubscription.findFirst({
        where: { moduleKey },
        select: { disabledAt: true },
      });

    if (!subscription || subscription.disabledAt !== null) {
      // Section 6.2: "If module is not enabled (disabledAt IS NOT NULL or row
      // absent): returns 403." The message names the module but reveals nothing
      // about other tenants' subscriptions.
      throw new ForbiddenException(
        `The ${moduleKey} module is not enabled for this tenant.`,
      );
    }
  }
}
