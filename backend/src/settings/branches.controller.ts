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
import {
  PaginatedEnvelope,
  PaginationQueryDto,
} from '../common/dto/pagination.dto';
import { BranchesService } from './branches.service';
import { CreateBranchDto, UpdateBranchDto } from './dto/branch.dto';
import { BranchResponse } from './dto/settings-response.dto';

/**
 * Section 6.4 — branches (FR-TEN-02/03).
 *
 * Gated on the `settings` module and permission, matching the section's opening
 * line: "All endpoints in this section require `settings.read` or
 * `settings.write` as noted." DELETE requires `settings.delete`, which under
 * Section 3.2's matrix is Owner-only — a Manager can create and edit branches but
 * cannot delete one.
 *
 * `ParseUUIDPipe` answers 400 for a malformed id, which is Section 6.1's code for
 * a bad path/query value; a well-formed id that belongs to another tenant is a
 * 404 from the service, never a 403 that would confirm the row exists.
 */
@Controller('branches')
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @RequiresPermission('settings', 'read')
  @Get()
  async list(
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedEnvelope<BranchResponse>> {
    return this.branches.list(query);
  }

  /**
   * 201 is Nest's default for POST, which matches Section 6.1's table.
   */
  @RequiresPermission('settings', 'write')
  @Post()
  async create(@Body() dto: CreateBranchDto): Promise<BranchResponse> {
    return this.branches.create(dto);
  }

  @RequiresPermission('settings', 'write')
  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBranchDto,
  ): Promise<BranchResponse> {
    return this.branches.update(id, dto);
  }

  @RequiresPermission('settings', 'delete')
  @Delete(':id')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BranchResponse> {
    return this.branches.remove(id);
  }
}
