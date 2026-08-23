import { IsBoolean, IsIn, IsISO8601, IsOptional } from 'class-validator';
import {
  MODULE_KEYS,
  type ModuleKey,
} from '../../access-control/access-control.constants';

/**
 * Body of PATCH /api/v1/billing/modules (Section 6.10, UC-04).
 *
 * There is deliberately no tenantId field. Tenant context comes only from the
 * validated JWT (Section 4.3) and the global ValidationPipe runs with
 * forbidNonWhitelisted, so a request that tries to smuggle one in is rejected
 * with 422 rather than having the property quietly dropped.
 */
export class UpdateModuleSubscriptionDto {
  /**
   * Validated against the canonical module list rather than accepted as free
   * text: an unrecognised key would otherwise create a subscription row that no
   * route can ever match, which looks like a silent success.
   */
  @IsIn([...MODULE_KEYS])
  moduleKey!: ModuleKey;

  @IsBoolean()
  enabled!: boolean;

  /**
   * Section 6.10 uses this to calculate proration. Proration is not currently
   * computable (see DEBT-018), so this value is validated and echoed back but
   * does not yet affect any charge. Defaults to today when omitted.
   */
  @IsOptional()
  @IsISO8601()
  effectiveDate?: string;

  /**
   * Two-step commit. The first call previews the change; only a call carrying
   * `confirmed: true` writes to TenantModuleSubscription. Section 6.10 requires
   * this so that a toggle cannot produce a billing side effect the tenant admin
   * never acknowledged.
   */
  @IsOptional()
  @IsBoolean()
  confirmed?: boolean;
}
