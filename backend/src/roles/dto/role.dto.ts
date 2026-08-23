import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';
import {
  ACTIONS,
  MODULE_KEYS,
  PERMISSION_GRID,
  type Action,
  type ModuleKey,
} from '../../access-control/access-control.constants';

/** Section 6.5 GET /roles. */
export interface RoleResponse {
  id: string;
  name: string;
  isBuiltIn: boolean;
}

/**
 * One cell of the permission grid.
 *
 * `granted: false` is reported for a pair with no stored row. The database keeps
 * only granted rows — that is what the seed writes and the only thing
 * PermissionGuard queries (`granted: true`) — so absence *is* denial. Synthesising
 * the negatives here means a client gets the complete grid without having to know
 * which pairs exist.
 */
export interface PermissionEntry {
  module: ModuleKey;
  action: Action;
  granted: boolean;
}

/** Body of POST /api/v1/roles. */
export class CreateRoleDto {
  /**
   * No `tenantId` and no `isBuiltIn`: Section 6.5 states tenantId comes from the
   * JWT, and a client that could set `isBuiltIn` would be able to mint an
   * undeletable role. `forbidNonWhitelisted` turns either attempt into a 422.
   */
  @IsString()
  @Length(1, 60)
  name!: string;
}

export class PermissionEntryDto {
  @IsIn([...MODULE_KEYS])
  module!: ModuleKey;

  @IsIn([...ACTIONS])
  action!: Action;

  @IsBoolean()
  granted!: boolean;
}

/** Body of PUT /api/v1/roles/:id/permissions. */
export class ReplacePermissionsDto {
  /**
   * Capped at the grid size. The endpoint replaces the whole set, so a request
   * larger than the number of pairs that exist is malformed by construction, and
   * the bound stops an unbounded body from reaching the validator.
   */
  @IsArray()
  @ArrayMaxSize(PERMISSION_GRID.length)
  @ValidateNested({ each: true })
  @Type(() => PermissionEntryDto)
  permissions!: PermissionEntryDto[];
}
