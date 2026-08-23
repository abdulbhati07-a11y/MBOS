import { Body, Controller, Get, Patch } from '@nestjs/common';
import { RequiresPermission } from '../access-control/access-control.decorators';
import { TenantSettingsResponse } from './dto/settings-response.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { SettingsService } from './settings.service';

/**
 * Section 6.4 — tenant settings. Resolves DEBT-008: the frontend currently
 * hardcodes `taxRate: 0` in NewOrderForm because there was no endpoint to read
 * the tenant's configured rate from.
 *
 * `tenantId` never appears in a route, a body, or a query here. It comes from the
 * validated JWT via AsyncLocalStorage, which Section 6.4 states explicitly.
 */
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  /**
   * Called at session start. Read-only for a Manager (`settings.read` is in the
   * Manager grant, `settings.write` is not — Section 3.2), so a Manager can see
   * the tax rate the POS applies without being able to change it.
   */
  @RequiresPermission('settings', 'read')
  @Get()
  async get(): Promise<TenantSettingsResponse> {
    return this.settings.get();
  }

  @RequiresPermission('settings', 'write')
  @Patch()
  async update(
    @Body() dto: UpdateSettingsDto,
  ): Promise<TenantSettingsResponse> {
    return this.settings.update(dto);
  }
}
