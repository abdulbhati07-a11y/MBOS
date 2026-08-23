import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

/**
 * Bodies for POST and PATCH /api/v1/branches (Section 6.4).
 *
 * Neither carries `tenantId` — see the note on UpdateSettingsDto. Neither carries
 * `deletedAt` either: deletion happens through DELETE, and letting a client set
 * the column directly would route around the referential checks that endpoint
 * performs.
 */
export class CreateBranchDto {
  @IsString()
  @Length(1, 120)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(0, 300)
  address?: string;

  /**
   * Promoting a branch to default demotes the current one in the same
   * transaction (Section 6.4). A partial unique index permits only one default
   * per tenant, so the two writes cannot be split.
   */
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** Same fields, all optional — PATCH is a partial update. */
export class UpdateBranchDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(0, 300)
  address?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
