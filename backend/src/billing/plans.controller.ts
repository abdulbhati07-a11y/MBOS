import { Controller, Get } from '@nestjs/common';
import { RequiresPermission } from '../access-control/access-control.decorators';
import { BillingService } from './billing.service';
import { ListEnvelope, PlanSummary } from './dto/billing-response.dto';

/**
 * Section 6.10 GET /api/v1/plans.
 *
 * A separate controller because the path is `/plans`, not `/billing/plans`, and
 * Section 6.1 allows no path aliasing. It shares BillingService because the plan
 * catalogue is only meaningful next to the subscription it prices.
 *
 * Section 6.10 calls this "public within the authenticated tenant context — no
 * special permission required beyond `settings.read`", so it is gated exactly
 * like the other reads. It is not @Public: the catalogue is only reachable by an
 * authenticated caller.
 *
 * Creating and editing plans is deliberately absent — Section 6.13 assigns plan
 * CRUD to the super-tenant admin API in Section 10.
 */
@Controller('plans')
export class PlansController {
  constructor(private readonly billing: BillingService) {}

  @RequiresPermission('settings', 'read')
  @Get()
  async listPlans(): Promise<ListEnvelope<PlanSummary>> {
    return { data: await this.billing.listPlans() };
  }
}
