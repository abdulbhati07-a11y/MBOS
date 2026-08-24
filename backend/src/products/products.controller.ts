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
  CreateProductDto,
  ProductListQueryDto,
  ProductResponse,
  UpdateProductDto,
} from './dto/product.dto';
import { ProductsService } from './products.service';

/**
 * Section 6.6 — products. Gated on `inventory`, which the section states
 * explicitly for POST and PATCH (`inventory.write`) and DELETE
 * (`inventory.delete`).
 *
 * Reads are open to every built-in role: a Cashier holds `inventory.read` because
 * the POS has to price and check stock on an item before selling it.
 */
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @RequiresPermission('inventory', 'read')
  @Get()
  async list(
    @Query() query: ProductListQueryDto,
  ): Promise<PaginatedEnvelope<ProductResponse>> {
    return this.products.list(query);
  }

  @RequiresPermission('inventory', 'write')
  @Post()
  async create(@Body() dto: CreateProductDto): Promise<ProductResponse> {
    return this.products.create(dto);
  }

  @RequiresPermission('inventory', 'read')
  @Get(':id')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ProductResponse> {
    return this.products.findOne(id);
  }

  @RequiresPermission('inventory', 'write')
  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ): Promise<ProductResponse> {
    return this.products.update(id, dto);
  }

  @RequiresPermission('inventory', 'delete')
  @Delete(':id')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ProductResponse> {
    return this.products.remove(id);
  }
}
