import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantSettingsResponse } from './dto/settings-response.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';

/**
 * Mirrors the column defaults on `TenantSettings` in schema.prisma. Duplicated
 * here on purpose: a tenant with no row yet must read as the same thing the
 * database would have created, and the API cannot ask Prisma for a default it has
 * never inserted.
 */
const SETTINGS_DEFAULTS: TenantSettingsResponse = {
  companyName: '',
  defaultTaxRateBps: 0,
  currencyCode: 'PKR',
  timezone: 'UTC',
};

const SETTINGS_SELECT = {
  companyName: true,
  defaultTaxRateBps: true,
  currencyCode: true,
  timezone: true,
} as const;

/** Section 6.4 — tenant settings. Resolves DEBT-008. */
@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /settings.
   *
   * `TenantSettings` is 1:1 with `Tenant` and the seed creates it, but a tenant
   * provisioned by another path may not have a row. Returning the schema defaults
   * beats 404 here: the frontend calls this at session start to populate the
   * company profile form and the POS default tax rate (DEBT-008), so a 404 would
   * turn a merely incomplete tenant into a broken session. The GET stays
   * read-only — the row is created by the first PATCH, not by being read.
   */
  async get(): Promise<TenantSettingsResponse> {
    const row = await this.prisma.db.tenantSettings.findFirst({
      select: SETTINGS_SELECT,
    });
    return row ?? { ...SETTINGS_DEFAULTS };
  }

  /**
   * PATCH /settings — partial update, only supplied fields change.
   *
   * `updateMany` rather than `update`: the tenant-scope extension injects
   * `tenantId` at the top level of `where`, which does not compose with the
   * single-field unique input `update` requires. `updateMany` takes a plain
   * filter, so the injected value is exactly right — and because there is no id
   * to supply, there is no id to get wrong, which makes reaching another tenant's
   * row impossible rather than merely guarded.
   */
  async update(dto: UpdateSettingsDto): Promise<TenantSettingsResponse> {
    const { count } = await this.prisma.db.tenantSettings.updateMany({
      data: { ...dto },
    });

    if (count === 0) {
      await this.prisma.db.tenantSettings.create({
        // `tenantId` is supplied by the extension at runtime; extensions rewrite
        // arguments but not input types, so the compiler still sees it as
        // missing. The Unchecked shape (scalar tenantId) records that it is
        // injected, not omitted — same reasoning as BillingService.commit().
        data: { ...dto } as Prisma.TenantSettingsUncheckedCreateInput,
      });
    }

    return this.get();
  }
}
