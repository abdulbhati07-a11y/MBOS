import {
  Body,
  Controller,
  Delete,
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
  CreateSupplierDto,
  SupplierDetailQueryDto,
  SupplierDetailResponse,
  SupplierListQueryDto,
  SupplierResponse,
  UpdateSupplierDto,
} from './dto/supplier.dto';
import { SuppliersService } from './suppliers.service';

/**
 * Section 6.6 — suppliers.
 *
 * Gated on `purchases`, not a `suppliers` module: the taxonomy has no such key
 * (MODULE_KEYS), and a supplier exists to be purchased from — the frontend nav
 * puts suppliers under Purchases for the same reason. The consequence is worth
 * stating, because it is a real access decision rather than a naming one: a
 * Cashier has no `purchases` grant at all, so a Cashier cannot read the supplier
 * list. That is consistent with Section 3.2's separation of duties, where
 * procurement is a Manager/Owner activity.
 */
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @RequiresPermission('purchases', 'read')
  @Get()
  async list(
    @Query() query: SupplierListQueryDto,
  ): Promise<PaginatedEnvelope<SupplierResponse>> {
    return this.suppliers.list(query);
  }

  @RequiresPermission('purchases', 'write')
  @Post()
  async create(@Body() dto: CreateSupplierDto): Promise<SupplierResponse> {
    return this.suppliers.create(dto);
  }

  @RequiresPermission('purchases', 'read')
  @Get(':id')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: SupplierDetailQueryDto,
  ): Promise<SupplierDetailResponse> {
    return this.suppliers.findOne(id, query);
  }

  @RequiresPermission('purchases', 'write')
  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSupplierDto,
  ): Promise<SupplierResponse> {
    return this.suppliers.update(id, dto);
  }

  @RequiresPermission('purchases', 'delete')
  @Delete(':id')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SupplierResponse> {
    return this.suppliers.remove(id);
  }
}
