import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  PERMISSION_GRID,
  ROLE_MATRIX,
  type Action,
  type ModuleKey,
} from '../access-control/access-control.constants';
import { visibleRoleWhere } from '../access-control/role-visibility';
import {
  PaginatedEnvelope,
  PaginationQueryDto,
  paginate,
  resolvePagination,
} from '../common/dto/pagination.dto';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import {
  CreateRoleDto,
  PermissionEntry,
  ReplacePermissionsDto,
  RoleResponse,
} from './dto/role.dto';

/** The three names the seed reserves for global built-ins (D-02). */
const BUILT_IN_NAMES: readonly string[] = Object.keys(ROLE_MATRIX);

const cellKey = (module: string, action: string) => `${module}.${action}`;

/**
 * Section 6.5 — roles and their permission sets. Resolves DEBT-007 (custom
 * roles, FR-SET-02) on the API side.
 *
 * THE UNSCOPED CLIENT, THROUGHOUT. `Role` and `RolePermission` are excluded from
 * SCOPED_MODELS because built-in roles carry `tenantId = null`, so an injected
 * `tenantId` filter would hide the three roles every tenant depends on
 * (tenant-scope.extension.ts says as much). Every query here therefore states the
 * boundary itself — `tenantId: null` OR this tenant — exactly as PermissionGuard
 * does. Getting that filter wrong is a cross-tenant leak, so it lives in one
 * place: `visibleRoleFilter()`.
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /** GET /roles — built-ins plus this tenant's custom roles. */
  async list(
    query: PaginationQueryDto,
  ): Promise<PaginatedEnvelope<RoleResponse>> {
    const page = resolvePagination(query);
    const where = this.visibleRoleFilter();

    const [rows, total] = await Promise.all([
      this.prisma.role.findMany({
        where,
        select: { id: true, name: true, isBuiltIn: true },
        // Built-ins first, then custom roles alphabetically: a permissions UI
        // lists the three fixed roles above whatever the tenant has added.
        orderBy: [{ isBuiltIn: 'desc' }, { name: 'asc' }],
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.role.count({ where }),
    ]);

    return paginate(rows, total, page);
  }

  /**
   * POST /roles — creates a custom role for the caller's tenant.
   *
   * Two collisions are possible and they need different answers:
   *
   *   - A **built-in** name. Rejected, even though `@@unique([tenantId, name])`
   *     would permit it (built-ins have `tenantId = null`, so the pair differs).
   *     A tenant-local "Owner" sitting next to the real one in the same list is a
   *     trap, not a feature.
   *   - A **soft-deleted** role of the same name. The unique constraint still
   *     counts that row, so creating afresh would fail on a name the tenant can
   *     no longer see. The row is revived with an empty permission set instead,
   *     which reads as a new role to every caller. Clearing the permissions is
   *     the important half: the id comes back too, and a stale token carrying it
   *     must not regain the old grants.
   */
  async create(dto: CreateRoleDto): Promise<RoleResponse> {
    const tenantId = this.requireTenantId();
    const name = dto.name.trim();

    if (BUILT_IN_NAMES.some((builtIn) => builtIn.toLowerCase() === name.toLowerCase())) {
      throw new ConflictException(
        `"${name}" is the name of a built-in role. Choose a different name.`,
      );
    }

    const existing = await this.prisma.role.findFirst({
      where: { tenantId, name },
      select: { id: true, deletedAt: true },
    });

    if (existing && existing.deletedAt === null) {
      throw new ConflictException(`A role named "${name}" already exists.`);
    }

    if (existing) {
      const [, revived] = await this.prisma.$transaction([
        this.prisma.rolePermission.deleteMany({ where: { roleId: existing.id } }),
        this.prisma.role.update({
          where: { id: existing.id },
          data: { deletedAt: null },
          select: { id: true, name: true, isBuiltIn: true },
        }),
      ]);
      return revived;
    }

    return this.prisma.role.create({
      data: { tenantId, name, isBuiltIn: false },
      select: { id: true, name: true, isBuiltIn: true },
    });
  }

  /**
   * DELETE /roles/:id — soft delete.
   *
   * Section 6.5: 403 when the role is built-in, 409 when a user still holds it.
   * 403 rather than 409 for a built-in is the section's choice and is kept even
   * though the obstacle is the role's nature rather than the caller's permission.
   */
  async remove(id: string): Promise<RoleResponse> {
    const role = await this.findVisibleOrThrow(id);

    if (role.isBuiltIn) {
      throw new ForbiddenException(
        'Built-in roles cannot be deleted (D-02). They are global and shared by ' +
          'every tenant.',
      );
    }

    // Users are tenant-scoped, so this counts holders inside this tenant only —
    // which is the whole population able to hold a tenant-local role anyway.
    const holders = await this.prisma.db.user.count({
      where: { roleId: id, deletedAt: null },
    });

    if (holders > 0) {
      throw new ConflictException(
        `${holders} user(s) still hold this role. Reassign them before ` +
          'deleting it.',
      );
    }

    return this.prisma.role.update({
      where: { id },
      data: { deletedAt: new Date() },
      select: { id: true, name: true, isBuiltIn: true },
    });
  }

  /**
   * GET /roles/:id/permissions — the complete grid, not just the stored rows.
   *
   * Section 6.5 calls it "the full permission set", and its example includes a
   * `granted: false` entry, so the negatives are synthesised from PERMISSION_GRID
   * rather than read from the table. This is what lets a client render a checkbox
   * grid without knowing which pairs happen to have rows.
   */
  async getPermissions(id: string): Promise<PermissionEntry[]> {
    await this.findVisibleOrThrow(id);

    const rows = await this.prisma.rolePermission.findMany({
      where: { roleId: id, granted: true },
      select: { module: true, action: true },
    });
    const granted = new Set(rows.map((row) => cellKey(row.module, row.action)));

    return PERMISSION_GRID.map(({ module, action }) => ({
      module,
      action,
      granted: granted.has(cellKey(module, action)),
    }));
  }

  /**
   * PUT /roles/:id/permissions — replaces the whole set. 403 for a built-in.
   *
   * Only `granted: true` entries are written. The table's convention is that a
   * row means "granted" — it is what the seed writes and the only thing
   * PermissionGuard looks for — so persisting explicit `false` rows would create a
   * second, redundant way to express denial that no reader consults.
   */
  async replacePermissions(
    id: string,
    dto: ReplacePermissionsDto,
  ): Promise<PermissionEntry[]> {
    const role = await this.findVisibleOrThrow(id);

    if (role.isBuiltIn) {
      throw new ForbiddenException(
        'Built-in role permissions cannot be modified. They are the canonical ' +
          'matrix every tenant shares (D-02, Section 3.2). Create a custom role ' +
          'instead.',
      );
    }

    const seen = new Set<string>();
    for (const entry of dto.permissions) {
      const key = cellKey(entry.module, entry.action);

      if (seen.has(key)) {
        throw new UnprocessableEntityException(
          `Duplicate permission ${key}. Each (module, action) pair may appear once.`,
        );
      }
      seen.add(key);

      // The DTO validates module and action independently, so `inventory.refund`
      // passes it while being meaningless: refund is Sales-scoped (BR-03). Reject
      // it here rather than storing a row no guard will ever ask about.
      if (entry.action === 'refund' && entry.module !== 'sales') {
        throw new UnprocessableEntityException(
          `refund applies to sales only, not ${entry.module} (BR-03).`,
        );
      }
    }

    const rows = dto.permissions
      .filter((entry) => entry.granted)
      .map((entry) => ({
        roleId: id,
        module: entry.module as ModuleKey,
        action: entry.action as Action,
        granted: true,
      }));

    // One transaction: a role must never be observable with its old permissions
    // deleted and its new ones not yet written, because the permission guard
    // reads this table on every request and would deny everything in that window.
    await this.prisma.$transaction([
      this.prisma.rolePermission.deleteMany({ where: { roleId: id } }),
      this.prisma.rolePermission.createMany({ data: rows }),
    ]);

    return this.getPermissions(id);
  }

  /**
   * The filter defining "roles this tenant may see". Delegates to the shared
   * `visibleRoleWhere` so this file and UsersService cannot drift apart — a
   * divergence between them would be a cross-tenant hole.
   */
  private visibleRoleFilter(): Prisma.RoleWhereInput {
    return visibleRoleWhere(this.requireTenantId());
  }

  /**
   * A visible role, or 404.
   *
   * Another tenant's role id yields 404 rather than 403 — a 403 would confirm the
   * role exists, which is the same disclosure PermissionGuard refuses to make.
   */
  private async findVisibleOrThrow(
    id: string,
  ): Promise<{ id: string; name: string; isBuiltIn: boolean }> {
    const role = await this.prisma.role.findFirst({
      where: { id, ...this.visibleRoleFilter() },
      select: { id: true, name: true, isBuiltIn: true },
    });

    if (!role) {
      throw new NotFoundException(`No role ${id} is available to this tenant.`);
    }
    return role;
  }

  private requireTenantId(): string {
    const tenantId = this.tenantContext.getTenantId();
    if (!tenantId) {
      throw new Error(
        'RolesService ran outside a request context. Role queries use the ' +
          'unscoped client and depend on the tenant context for their filter.',
      );
    }
    return tenantId;
  }
}
