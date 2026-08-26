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
  CreateUserDto,
  UpdateUserDto,
  UserListQueryDto,
  UserResponse,
} from './dto/user.dto';
import { UsersService } from './users.service';

/**
 * Section 6.5 — user management.
 *
 * Permissions are the section's own: `settings.read` to list, `settings.write` to
 * create and update, `settings.delete` to remove. Under Section 3.2 that makes
 * every write Owner-only, while a Manager can see the roster.
 *
 * No response from this controller carries a password hash or MFA secret — see
 * UserResponse.
 */
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @RequiresPermission('settings', 'read')
  @Get()
  async list(
    @Query() query: UserListQueryDto,
  ): Promise<PaginatedEnvelope<UserResponse>> {
    return this.users.list(query);
  }

  /**
   * Creates a user with an explicit password, validated against the Section
   * 3.3.1 policy. Section 6.5 calls this "create/invite"; the invite half needs a
   * mail transport that does not exist yet (DEBT-015), and an invite that sends
   * nothing is worse than requiring a password.
   */
  @RequiresPermission('settings', 'write')
  @Post()
  async create(@Body() dto: CreateUserDto): Promise<UserResponse> {
    return this.users.create(dto);
  }

  @RequiresPermission('settings', 'write')
  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<UserResponse> {
    return this.users.update(id, dto);
  }

  @RequiresPermission('settings', 'delete')
  @Delete(':id')
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<UserResponse> {
    return this.users.remove(id);
  }
}
