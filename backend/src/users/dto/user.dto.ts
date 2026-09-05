import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { IsPolicyPassword } from '../../common/validation/password';
import { IsOptionalBooleanQuery } from '../../common/validation/query-filters';

/**
 * A user as the API reports it.
 *
 * `passwordHash` and `mfaSecret` are absent and must stay absent — they are
 * credentials, and an admin listing users has no need for either. `roleName` is
 * included alongside `roleId` so a list is readable without a second request,
 * but authorization never keys on the name (PermissionGuard reads the role's
 * rows, not its label).
 */
export interface UserResponse {
  id: string;
  email: string;
  roleId: string;
  roleName: string;
  isActive: boolean;
  mfaEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Query for GET /api/v1/users. */
export class UserListQueryDto extends PaginationQueryDto {
  /** `?isActive=true|false` — see IsOptionalBooleanQuery for why it is not implicit. */
  @IsOptionalBooleanQuery()
  isActive?: boolean;
}

/** Body of POST /api/v1/users. */
export class CreateUserDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  /**
   * Section 6.5 describes this endpoint as "create/invite". Invite-by-email is
   * not implementable yet: no mail transport is configured, so MailProvider is a
   * no-op and an invited user would be told nothing (DEBT-015). An explicit
   * password is therefore required, validated against Section 3.3.1. When a
   * transport is chosen, an invite flow can make this optional.
   */
  @IsString()
  @IsPolicyPassword()
  password!: string;

  /** Must be a built-in role or one of this tenant's own; validated in the service. */
  @IsUUID()
  roleId!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** Body of PATCH /api/v1/users/:id. */
export class UpdateUserDto {
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @IsUUID()
  roleId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /**
   * Deliberately no `password` field. An admin silently resetting another user's
   * password is a different operation with different auditing needs, and the
   * user's own change belongs to the Section 6.3 password-reset flow. Omitting it
   * keeps this endpoint to identity and role assignment.
   */
}
