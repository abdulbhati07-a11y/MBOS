import { Body, Controller, Get, Patch } from '@nestjs/common';
import { RequiresPermission } from '../access-control/access-control.decorators';
import { BillingService } from './billing.service';
import {
  ListEnvelope,
  ModuleStatus,
  ModuleToggleResult,
  SubscriptionSummary,
} from './dto/billing-response.dto';
import { UpdateModuleSubscriptionDto } from './dto/update-module-subscription.dto';

/**
 * Section 6.10 — the write side of the module gating that chain step 5 enforces
 * on read.
 *
 * PERMISSIONS follow Section 6.10 verbatim: "All endpoints require
 * `settings.write` unless noted", with the reads "readable with
 * `settings.read`". Note that this means these endpoints are gated on the
 * `settings` module and permission, NOT on `billing` — so the `billing` module
 * key currently gates nothing at all. That is the doc's contract, so it is what
 * is implemented; the discrepancy is recorded in DEBT-016/DEBT-018 rather than
 * silently "corrected" here.
 *
 * A consequence worth knowing: because the reads need only `settings.read`, a
 * Manager can see what modules a tenant has, but cannot change them.
 */
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @RequiresPermission('settings', 'read')
  @Get('modules')
  async listModules(): Promise<ListEnvelope<ModuleStatus>> {
    return { data: await this.billing.listModules() };
  }

  @RequiresPermission('settings', 'read')
  @Get('subscription')
  async getSubscription(): Promise<SubscriptionSummary> {
    return this.billing.getSubscription();
  }

  /**
   * UC-04. Takes effect on the next request rather than the next deployment,
   * because the module-access guard reads TenantModuleSubscription every time
   * (FR-BILL-03) with no caching.
   *
   * PATCH, not POST. Section 6.10 declares the endpoint as PATCH but then
   * describes the confirmation step as a "re-POST"; the verb it declares wins,
   * and the confirmation is the same PATCH carrying `confirmed: true`.
   */
  @RequiresPermission('settings', 'write')
  @Patch('modules')
  async updateModule(
    @Body() dto: UpdateModuleSubscriptionDto,
  ): Promise<ModuleToggleResult> {
    return this.billing.updateModule(dto);
  }
}
