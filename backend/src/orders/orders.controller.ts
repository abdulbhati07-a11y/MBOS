import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { RequiresPermission } from '../access-control/access-control.decorators';
import { PaginatedEnvelope } from '../common/dto/pagination.dto';
import {
  CreateOrderDto,
  CreateRefundDto,
  OrderDetailResponse,
  OrderListQueryDto,
  OrderResponse,
  RefundResponse,
  UpdateOrderStatusDto,
} from './dto/order.dto';
import { OrdersService } from './orders.service';

/**
 * Section 6.7 — orders. Gated on `sales`.
 *
 * Two things about this surface are deliberate absences:
 *
 *   - **No `DELETE`.** BR-03 forbids hard-deleting a posted transaction, and
 *     Section 6.7 is specific that the route must be *unregistered* so a client
 *     gets 404 rather than a 403 implying the operation exists behind a
 *     permission. There is no `remove` on the service either, so no future
 *     decorator can accidentally expose one.
 *   - **Refund is not `sales.write`.** It requires `sales.refund`, which no
 *     built-in Cashier role holds. That distinction is BR-03 at the RBAC layer:
 *     taking money and giving it back are separately grantable.
 *
 * `PATCH /:id/status` takes a body it barely reads — the DTO permits only
 * `Completed`, so the transition is fixed. It stays a body rather than a bare
 * `POST /:id/complete` because Section 6.7 specifies `{ "status": "Completed" }`,
 * and a client sending anything else gets a 422 naming the field.
 */
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @RequiresPermission('sales', 'read')
  @Get()
  async list(
    @Query() query: OrderListQueryDto,
  ): Promise<PaginatedEnvelope<OrderResponse>> {
    return this.orders.list(query);
  }

  @RequiresPermission('sales', 'write')
  @Post()
  async create(@Body() dto: CreateOrderDto): Promise<OrderDetailResponse> {
    return this.orders.create(dto);
  }

  @RequiresPermission('sales', 'read')
  @Get(':id')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrderDetailResponse> {
    return this.orders.findOne(id);
  }

  @RequiresPermission('sales', 'write')
  @Patch(':id/status')
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    // Validated but unused: `UpdateOrderStatusDto` permits only 'Completed', so
    // binding it is what rejects every other transition before the service runs.
    @Body() _dto: UpdateOrderStatusDto,
  ): Promise<OrderDetailResponse> {
    return this.orders.updateStatus(id);
  }

  @RequiresPermission('sales', 'refund')
  @Post(':id/refund')
  async refund(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateRefundDto,
  ): Promise<RefundResponse> {
    return this.orders.refund(id, dto);
  }
}
