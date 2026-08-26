import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { RequiresPermission } from '../access-control/access-control.decorators';
import {
  PaginatedEnvelope,
  PaginationQueryDto,
} from '../common/dto/pagination.dto';
import {
  CreateRoleDto,
  PermissionEntry,
  ReplacePermissionsDto,
  RoleResponse,
} from './dto/role.dto';
import { RolesService } from './roles.service';

/** Section 6.1 uses `data` for a non-paginated list. */
interface ListEnvelope<T> {
  data: T[];
}

/**
 * Section 6.5 — access-control endpoints. Resolves DEBT-006 and DEBT-007 on the
 * API side: the frontend's `RoleProvider` currently invents its permission matrix
 * client-side, and these endpoints are what let it read the real one.
 *
 * Gated on `settings`, matching the section: POST and PUT require `settings.write`
 * and DELETE requires `settings.delete` — the same code the section assigns to
 * `DELETE /users/:id`, so role and user deletion need the same authority. Under
 * Section 3.2 that makes both Owner-only, while a Manager can still read the
 * matrix (`settings.read`) to see what a role permits.
 */
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @RequiresPermission('settings', 'read')
  @Get()
  async list(
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedEnvelope<RoleResponse>> {
    return this.roles.list(query);
  }

  @RequiresPermission('settings', 'write')
  @Post()
  async create(@Body() dto: CreateRoleDto): Promise<RoleResponse> {
    return this.roles.create(dto);
  }

  @RequiresPermission('settings', 'delete')
  @Delete(':id')
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<RoleResponse> {
    return this.roles.remove(id);
  }

  @RequiresPermission('settings', 'read')
  @Get(':id/permissions')
  async getPermissions(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ListEnvelope<PermissionEntry>> {
    return { data: await this.roles.getPermissions(id) };
  }

  /**
   * PUT, not PATCH: this replaces the entire set. An entry omitted from the body
   * is revoked, which is what makes the operation idempotent and safe to re-send.
   */
  @RequiresPermission('settings', 'write')
  @Put(':id/permissions')
  async replacePermissions(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplacePermissionsDto,
  ): Promise<ListEnvelope<PermissionEntry>> {
    return { data: await this.roles.replacePermissions(id, dto) };
  }
}
