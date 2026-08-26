import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { RequiresPermission } from '../access-control/access-control.decorators';
import { PaginatedEnvelope } from '../common/dto/pagination.dto';
import {
  AdjustmentListQueryDto,
  AdjustmentResponse,
  AlertsResponse,
  CreateAdjustmentDto,
} from './dto/inventory.dto';
import { InventoryService } from './inventory.service';

/**
 * Section 6.8 — inventory. Gated on `inventory`.
 *
 * The audit log is append-only: there is no `PATCH` and no `DELETE` on an
 * adjustment, and no service method for either. A wrong adjustment is corrected
 * by filing a compensating one, which is what keeps the log a history rather than
 * a mutable opinion about the current count (BR-02).
 *
 * `Cashier` holds `inventory.read` only (`ROLE_MATRIX`), so a cashier can see the
 * alerts widget and the log but cannot move stock by hand — their stock movements
 * happen through completing a sale.
 */
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @RequiresPermission('inventory', 'read')
  @Get('adjustments')
  async list(
    @Query() query: AdjustmentListQueryDto,
  ): Promise<PaginatedEnvelope<AdjustmentResponse>> {
    return this.inventory.list(query);
  }

  @RequiresPermission('inventory', 'write')
  @Post('adjustments')
  async create(@Body() dto: CreateAdjustmentDto): Promise<AdjustmentResponse> {
    return this.inventory.create(dto);
  }

  @RequiresPermission('inventory', 'read')
  @Get('alerts')
  async alerts(): Promise<AlertsResponse> {
    return this.inventory.alerts();
  }
}
