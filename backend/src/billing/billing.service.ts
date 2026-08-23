import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  INDUSTRY_MODULE_KEYS,
  ModuleKey,
  isIndustryModule,
} from '../access-control/access-control.constants';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateModuleSubscriptionDto } from './dto/update-module-subscription.dto';
import {
  ModuleStatus,
  ModuleToggleResult,
  PlanSummary,
  SubscriptionSummary,
} from './dto/billing-response.dto';

@Injectable()
export class BillingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Section 6.10 GET /billing/modules.
   *
   * Reports the modules a tenant can actually subscribe to — the industry
   * add-ons — and their current status (DEBT-016). Core modules are RBAC-only,
   * never carry a row, and can never be toggled here, so listing them would only
   * imply a control this endpoint does not offer. An industry module with no row
   * has never been subscribed and is reported as disabled, the same answer the
   * middleware gives it.
   */
  async listModules(): Promise<ModuleStatus[]> {
    // Tenant-scoped client: the extension supplies tenantId, so this cannot read
    // another tenant's subscriptions.
    const rows = await this.prisma.db.tenantModuleSubscription.findMany({
      select: { moduleKey: true, enabledAt: true, disabledAt: true },
    });
    const byKey = new Map(rows.map((row) => [row.moduleKey, row]));

    return INDUSTRY_MODULE_KEYS.map((moduleKey) => {
      const row = byKey.get(moduleKey);
      return {
        moduleKey,
        // Exactly Section 6.10's rule: a row exists AND disabledAt is null.
        enabled: row !== undefined && row.disabledAt === null,
        enabledAt: row?.enabledAt?.toISOString(),
        disabledAt: row?.disabledAt?.toISOString() ?? undefined,
      };
    });
  }

  /** Section 6.10 GET /billing/subscription. */
  async getSubscription(): Promise<SubscriptionSummary> {
    const subscription = await this.prisma.db.tenantSubscription.findFirst({
      select: {
        status: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
        plan: { select: { name: true, priceMonthly: true } },
      },
    });

    if (!subscription) {
      // Section 6.10 does not say what to return when a tenant has no billing
      // record. 404 is the honest answer under Section 6.1's conventions —
      // inventing a synthetic "no plan" body would make a missing subscription
      // indistinguishable from a real free tier.
      throw new NotFoundException('No subscription exists for this tenant.');
    }

    return {
      plan: {
        name: subscription.plan.name,
        priceMonthly: subscription.plan.priceMonthly,
      },
      status: subscription.status,
      currentPeriodStart: subscription.currentPeriodStart.toISOString(),
      currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
    };
  }

  /**
   * Section 6.10 GET /plans.
   *
   * The unscoped client: Plan and PlanModule are a global catalogue, excluded
   * from SCOPED_MODELS, and are not tenant data. `modules` here is informational
   * only — Section 6.10 is explicit that it "is not the live access-control
   * list", which is what listModules() above returns.
   */
  async listPlans(): Promise<PlanSummary[]> {
    const plans = await this.prisma.plan.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        priceMonthly: true,
        modules: { select: { moduleKey: true } },
      },
      orderBy: { priceMonthly: 'asc' },
    });

    return plans.map((plan) => ({
      id: plan.id,
      name: plan.name,
      priceMonthly: plan.priceMonthly,
      modules: plan.modules.map((planModule) => planModule.moduleKey),
    }));
  }

  /**
   * Section 6.10 PATCH /billing/modules (UC-04).
   *
   * Two-step: a call without `confirmed: true` previews and writes nothing; a
   * call with it commits. The confirm gate is kept even though no charge can be
   * previewed (DEBT-018), because it still stops an accidental toggle from
   * silently changing what a whole tenant can reach.
   *
   * The pending change is not stored anywhere between the two calls — the client
   * re-sends the same body. Section 6.10 does not say where pending state should
   * live, and a stateless recompute needs no new entity and cannot go stale.
   */
  async updateModule(
    dto: UpdateModuleSubscriptionDto,
  ): Promise<ModuleToggleResult> {
    const effectiveDate = dto.effectiveDate ?? today();

    // Core modules are RBAC-only and never carry a subscription row (DEBT-016),
    // so there is nothing to toggle: enabling one would write a row the system
    // must never contain, and disabling one is meaningless. Reject both with 409
    // rather than silently no-op, so a client that thinks it is gating a core
    // module learns it is wrong. The DTO already rejects an unknown key with 422,
    // so anything reaching here is a real-but-core key.
    if (!isIndustryModule(dto.moduleKey)) {
      throw new ConflictException(
        `The ${dto.moduleKey} module is a core module: it is always available ` +
          'and cannot be subscribed to or cancelled. Only industry modules ' +
          `(${INDUSTRY_MODULE_KEYS.join(', ')}) can be toggled.`,
      );
    }

    const existing = await this.prisma.db.tenantModuleSubscription.findFirst({
      where: { moduleKey: dto.moduleKey },
      select: { id: true, disabledAt: true },
    });
    const currentlyEnabled = existing !== null && existing.disabledAt === null;

    // Already in the requested state: nothing changes, so there is nothing to
    // bill and nothing to confirm.
    if (currentlyEnabled === dto.enabled) {
      return {
        moduleKey: dto.moduleKey,
        enabled: dto.enabled,
        proratedChargeCents: null,
        effectiveDate,
        committed: true,
        message: `The ${dto.moduleKey} module is already ${
          dto.enabled ? 'enabled' : 'disabled'
        }. No change was made.`,
      };
    }

    if (dto.confirmed !== true) {
      return {
        moduleKey: dto.moduleKey,
        enabled: dto.enabled,
        // Section 6.10 expects a prorated figure here. It cannot be computed:
        // nothing in Section 5 stores a per-module price (Plan prices a whole
        // plan; PlanModule has no price column), and FR-BILL-02 is referenced
        // but defined nowhere. Reporting null is the honest answer — DEBT-018.
        proratedChargeCents: null,
        effectiveDate,
        committed: false,
        message:
          `The ${dto.moduleKey} module will be ` +
          `${dto.enabled ? 'enabled' : 'disabled'} on ${effectiveDate}. ` +
          'A billing preview is not available yet, so no charge is shown. ' +
          'Re-send this request with "confirmed": true to apply the change.',
      };
    }

    await this.commit(dto.moduleKey, dto.enabled, existing?.id);

    return {
      moduleKey: dto.moduleKey,
      enabled: dto.enabled,
      proratedChargeCents: null,
      effectiveDate,
      committed: true,
      message:
        `The ${dto.moduleKey} module is now ` +
        `${dto.enabled ? 'enabled' : 'disabled'}. ` +
        'The change applies to the next request from any user in this tenant.',
    };
  }

  /**
   * Writes the change. Enabling clears `disabledAt`, disabling stamps it — the
   * row is never deleted, so the subscription history survives (Section 5.3).
   *
   * `enabledAt` is deliberately left alone on a re-enable, because Section 5.3
   * defines enabling as exactly "sets `disabledAt = NULL` on an existing row".
   * That means after a disable/re-enable cycle `enabledAt` still reports the
   * first time the module was ever switched on, not the start of the current
   * subscription period — the schema has one pair of columns for what is really
   * a history of periods. Harmless today and noted in DEBT-018, but it is one of
   * the reasons proration cannot be computed from this table.
   *
   * findFirst-then-write rather than upsert: the tenant-scope extension spreads
   * `tenantId` at the top level of `where`, which does not compose with the
   * `tenantId_moduleKey` compound-unique input that upsert requires.
   */
  private async commit(
    moduleKey: ModuleKey,
    enabled: boolean,
    existingId: string | undefined,
  ): Promise<void> {
    if (existingId) {
      await this.prisma.db.tenantModuleSubscription.update({
        where: { id: existingId },
        data: { disabledAt: enabled ? null : new Date() },
      });
      return;
    }

    // No row yet. Only reachable when enabling: a module with no row already
    // reads as disabled, so a disable request would have returned early above.
    await this.prisma.db.tenantModuleSubscription.create({
      // The tenant-scope extension injects tenantId into `data` at runtime
      // (tenant-scope.extension.ts). Prisma client extensions rewrite the
      // arguments but not the input types, so the compiler still sees tenantId
      // as missing here; the assertion records that it is supplied by the
      // extension, not omitted — hence the UncheckedCreateInput (scalar
      // tenantId) shape rather than a `tenant` connect.
      data: { moduleKey } as Prisma.TenantModuleSubscriptionUncheckedCreateInput,
    });
  }
}

/** Today as `YYYY-MM-DD`, matching the date-only form Section 6.10 shows. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}
