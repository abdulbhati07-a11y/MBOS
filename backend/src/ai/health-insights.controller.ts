import { Controller, Get, Query } from '@nestjs/common';
import { RequiresPermission } from '../access-control/access-control.decorators';
import { InsightsQueryDto } from './dto/insights.dto';
import { HealthInsightsService } from './health-insights.service';

/**
 * FR-AI-03 — Dashboard Health Score and insights.
 *
 * Gated on `dashboard.read`, which every built-in role holds. The score is
 * deterministic and cheap; the AI contribution is optional prose. A role
 * without `reports.read` (a Cashier) still sees the score — the components
 * deliberately avoid any figure the reports gate would hide, because the
 * endpoint is the dashboard's, not the reports'.
 *
 * Read-only and informational (Phase 1 rule): nothing here writes, and no AI
 * output can mutate data — a rule that stays true by construction because the
 * service has no write path at all.
 */
@Controller('dashboard')
export class HealthInsightsController {
  constructor(private readonly insights: HealthInsightsService) {}

  @RequiresPermission('dashboard', 'read')
  @Get('insights')
  async getInsights(
    @Query() query: InsightsQueryDto,
  ): Promise<ReturnType<HealthInsightsService['getInsights']>> {
    return this.insights.getInsights(query.days);
  }
}
