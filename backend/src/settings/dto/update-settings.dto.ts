import {
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

/** 10 000 basis points = 100%. A tax rate above par is a typo, not a policy. */
const MAX_TAX_RATE_BPS = 10_000;

/**
 * Body of PATCH /api/v1/settings (Section 6.4).
 *
 * Every field is optional because the section specifies a partial update — "only
 * supplied fields are changed". There is deliberately no `tenantId`: tenant
 * context comes from the validated JWT alone (Section 6.4 states `tenantId` is
 * "never accepted from the request body"), and the global ValidationPipe runs
 * with `forbidNonWhitelisted`, so smuggling one in is a 422 rather than a
 * silently ignored property.
 */
export class UpdateSettingsDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  companyName?: string;

  /**
   * Basis points, integer. Rejecting a float here is the point: accepting 8.5
   * would make the stored rate unrepresentable and push a rounding decision into
   * whatever computed the next order total (NFR-14, BR-05).
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_TAX_RATE_BPS)
  defaultTaxRateBps?: number;

  /** ISO 4217: exactly three uppercase letters. One currency per tenant (C-01). */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/, {
    message: 'currencyCode must be a three-letter ISO 4217 code, e.g. USD',
  })
  currencyCode?: string;

  /**
   * IANA zone name. This checks the *shape* only (`Area/Location`, or `UTC`); it
   * does not prove the zone exists in the runtime's tz database. A shape check
   * catches the realistic error — a display string like "GMT+5" or an empty
   * value — without pinning the API to one Node version's zone list.
   */
  @IsOptional()
  @IsString()
  @Matches(/^(UTC|[A-Za-z_]+\/[A-Za-z0-9_+\-/]+)$/, {
    message: 'timezone must be an IANA zone name, e.g. America/New_York or UTC',
  })
  timezone?: string;
}
