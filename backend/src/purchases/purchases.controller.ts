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
  CreatePurchaseOrderDto,
  POStatusTransitionResponse,
  PurchaseOrderDetailResponse,
  PurchaseOrderListQueryDto,
  PurchaseOrderResponse,
  UpdatePOStatusDto,
} from './dto/purchase-order.dto';
import { PurchasesService } from './purchases.service';

/**
 * Section 6.9 — purchase orders. Gated on `purchases`.
 *
 * The absences are the design, and they are the same absences Section 6.7's
 * orders surface has, for the same reason — BR-03: a posted document is not
 * edited or deleted, it is superseded.
 *
 *   - **No `DELETE`.** Unregistered rather than forbidden, so a client gets 404
 *     and not a 403 that would imply the operation exists behind a permission it
 *     lacks. `PurchasesService` has no `remove`, so no later decorator can expose
 *     one by accident. `purchases: rwd` on the Owner role grants a `delete` that
 *     nothing here consumes; the grant is the taxonomy being uniform, not a
 *     promise that the route exists.
 *   - **No financial `PATCH`.** Money and lines are set once, at `POST`. The only
 *     mutation is `PATCH /:id/status`, and it writes exactly one column.
 *
 * `PATCH /:id/status` needs `write`, not a separate action. Receiving goods moves
 * stock, which is arguably `inventory.write` territory — but the authority being
 * exercised is "advance this purchase order", and splitting it would let a role
 * send a PO it could never receive, stranding the document. Section 6.9 asks for
 * one `purchases` gate, and Manager (`purchases: rw`) is the role that runs the
 * whole cycle.
 */
@Controller('purchase-orders')
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}

  @RequiresPermission('purchases', 'read')
  @Get()
  async list(
    @Query() query: PurchaseOrderListQueryDto,
  ): Promise<PaginatedEnvelope<PurchaseOrderResponse>> {
    return this.purchases.list(query);
  }

  @RequiresPermission('purchases', 'write')
  @Post()
  async create(
    @Body() dto: CreatePurchaseOrderDto,
  ): Promise<PurchaseOrderDetailResponse> {
    return this.purchases.create(dto);
  }

  @RequiresPermission('purchases', 'read')
  @Get(':id')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PurchaseOrderDetailResponse> {
    return this.purchases.findOne(id);
  }

  @RequiresPermission('purchases', 'write')
  @Patch(':id/status')
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePOStatusDto,
  ): Promise<PurchaseOrderDetailResponse> {
    return this.purchases.updateStatus(id, dto);
  }

  /**
   * The status history on its own. `read`, not `write` — it is the audit trail,
   * and anyone who can see the PO can see how it got where it is.
   *
   * Its path cannot be shadowed by `:id` above: Nest matches on the full path, so
   * `:id/transitions` and `:id` are distinct routes regardless of declaration
   * order.
   */
  @RequiresPermission('purchases', 'read')
  @Get(':id/transitions')
  async listTransitions(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<POStatusTransitionResponse[]> {
    return this.purchases.listTransitions(id);
  }
}
