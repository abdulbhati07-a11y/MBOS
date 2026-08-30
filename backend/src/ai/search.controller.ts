import { Controller, Get, Query } from '@nestjs/common';
import { NoModuleRequired } from '../access-control/access-control.decorators';
import { Action, ModuleKey } from '../access-control/access-control.constants';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { SearchQueryDto, SearchResponse } from './dto/search.dto';
import { SearchService } from './search.service';

/**
 * GET /search — Smart Search (Phase 1).
 *
 * `@NoModuleRequired` because search crosses modules: a flat gate would either
 * lock the search box behind one module's permission or leak sections a role
 * cannot see. Instead the route is authenticated-only (the decorator still
 * requires a valid token — it is not `@Public()`), and each section inside
 * filters on the caller's own permissions via {@link SearchController.can},
 * which mirrors PermissionGuard's lookup in soft form: a role without the
 * permission gets an empty section, the same shape as "no matches", rather
 * than a 403 that would blank the whole search box. The reasoning is recorded
 * on SearchService.
 */
@Controller('search')
export class SearchController {
  constructor(
    private readonly searchService: SearchService,
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @NoModuleRequired()
  @Get()
  async search(@Query() query: SearchQueryDto): Promise<SearchResponse> {
    const canReadInventory = await this.can('inventory', 'read');
    return this.searchService.search(query.q, canReadInventory);
  }

  /**
   * The soft half of PermissionGuard: same unscoped role lookup, same
   * tenant-boundary re-check (a roleId from a stale or forged token must not
   * honour another tenant's permissions), but `false` instead of 403.
   */
  private async can(module: ModuleKey, action: Action): Promise<boolean> {
    const context = this.tenantContext.get();
    if (!context) return false;

    const role = await this.prisma.role.findUnique({
      where: { id: context.roleId },
      select: {
        tenantId: true,
        permissions: {
          where: { module, action, granted: true },
          select: { id: true },
        },
      },
    });
    if (!role) return false;

    const isGlobalBuiltIn = role.tenantId === null;
    const belongsToTenant = role.tenantId === context.tenantId;
    return (isGlobalBuiltIn || belongsToTenant) && role.permissions.length > 0;
  }
}
