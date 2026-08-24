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
import { CustomersService } from './customers.service';
import {
  CreateCustomerDto,
  CustomerDetailQueryDto,
  CustomerDetailResponse,
  CustomerListQueryDto,
  CustomerResponse,
  UpdateCustomerDto,
} from './dto/customer.dto';

/**
 * Section 6.6 — customers. Gated on the `customers` module exactly as the section
 * assigns: `customers.write` for POST and PATCH, `customers.delete` for DELETE.
 *
 * Under the built-in role matrix that makes a Cashier read-only here (they hold
 * `customers.read` alone) and leaves deletion to an Owner, since Manager has no
 * `customers.delete`.
 */
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @RequiresPermission('customers', 'read')
  @Get()
  async list(
    @Query() query: CustomerListQueryDto,
  ): Promise<PaginatedEnvelope<CustomerResponse>> {
    return this.customers.list(query);
  }

  @RequiresPermission('customers', 'write')
  @Post()
  async create(@Body() dto: CreateCustomerDto): Promise<CustomerResponse> {
    return this.customers.create(dto);
  }

  @RequiresPermission('customers', 'read')
  @Get(':id')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: CustomerDetailQueryDto,
  ): Promise<CustomerDetailResponse> {
    return this.customers.findOne(id, query);
  }

  @RequiresPermission('customers', 'write')
  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerDto,
  ): Promise<CustomerResponse> {
    return this.customers.update(id, dto);
  }

  @RequiresPermission('customers', 'delete')
  @Delete(':id')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CustomerResponse> {
    return this.customers.remove(id);
  }
}
