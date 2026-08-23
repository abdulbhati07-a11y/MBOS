import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PaginatedEnvelope,
  PaginationQueryDto,
  paginate,
  resolvePagination,
} from '../common/dto/pagination.dto';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBranchDto, UpdateBranchDto } from './dto/branch.dto';
import { BranchResponse } from './dto/settings-response.dto';

const BRANCH_SELECT = {
  id: true,
  name: true,
  address: true,
  isDefault: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

type BranchRow = {
  id: string;
  name: string;
  address: string;
  isDefault: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Section 6.4 — branches (FR-TEN-02, FR-TEN-03).
 *
 * Two invariants shape every method here:
 *
 * 1. **Soft delete is explicit.** `tenant-scope.extension.ts` injects `tenantId`
 *    and nothing else. Section 5.1 describes middleware that appends
 *    `deletedAt IS NULL`, but no such middleware exists, so every read in this
 *    file states the filter itself. Omitting it would resurrect deleted branches
 *    in list results — the kind of bug that looks like a data problem.
 *
 * 2. **Exactly one default branch per tenant**, enforced by a partial unique
 *    index (`20260821150000_add_constraints`) that Prisma cannot express natively.
 *    Any write touching `isDefault` therefore demotes the incumbent in the same
 *    transaction.
 */
@Injectable()
export class BranchesService {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /branches — paginated per Section 6.1. */
  async list(
    query: PaginationQueryDto,
  ): Promise<PaginatedEnvelope<BranchResponse>> {
    const page = resolvePagination(query);
    const where = { deletedAt: null };

    const [rows, total] = await Promise.all([
      this.prisma.db.branch.findMany({
        where,
        select: BRANCH_SELECT,
        // Default first, then alphabetical: the Branch Switcher in AppShell
        // renders this list directly, and the default is the one a user most
        // often wants.
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.db.branch.count({ where }),
    ]);

    return paginate(rows.map(toResponse), total, page);
  }

  /** POST /branches. */
  async create(dto: CreateBranchDto): Promise<BranchResponse> {
    const data = {
      name: dto.name,
      address: dto.address ?? '',
      isDefault: dto.isDefault ?? false,
      ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }),
      // tenantId is injected by the scope extension — see SettingsService.update.
    } as Prisma.BranchUncheckedCreateInput;

    if (dto.isDefault !== true) {
      const created = await this.prisma.db.branch.create({
        data,
        select: BRANCH_SELECT,
      });
      return toResponse(created);
    }

    // Section 6.4: "If `isDefault: true`, the existing default branch's
    // `isDefault` is set to `false` atomically." Outside a transaction the two
    // statements would either trip the partial unique index or, if the insert
    // failed after the demotion, leave the tenant with no default at all.
    const [, created] = await this.prisma.db.$transaction([
      this.prisma.db.branch.updateMany({
        where: { isDefault: true, deletedAt: null },
        data: { isDefault: false },
      }),
      this.prisma.db.branch.create({ data, select: BRANCH_SELECT }),
    ]);

    return toResponse(created);
  }

  /** PATCH /branches/:id. */
  async update(id: string, dto: UpdateBranchDto): Promise<BranchResponse> {
    const current = await this.findLiveOrThrow(id);

    // Demoting the current default would leave the tenant with none. FR-TEN-02
    // requires every tenant to have a default branch, so the way to change which
    // one it is is to promote the replacement — that path demotes this one
    // atomically. Section 6.4 does not spell this out; it follows from the
    // invariant, and refusing loudly beats silently ending up with no default.
    if (dto.isDefault === false && current.isDefault) {
      throw new ConflictException(
        'This is the default branch and cannot simply be un-defaulted, which ' +
          'would leave the tenant without one. Promote another branch instead ' +
          '(PATCH it with isDefault: true) — that demotes this one atomically.',
      );
    }

    if (dto.isDefault === true && !current.isDefault) {
      const [, updated] = await this.prisma.db.$transaction([
        this.prisma.db.branch.updateMany({
          where: { isDefault: true, deletedAt: null },
          data: { isDefault: false },
        }),
        this.prisma.db.branch.update({
          where: { id },
          data: { ...dto },
          select: BRANCH_SELECT,
        }),
      ]);
      return toResponse(updated);
    }

    const updated = await this.prisma.db.branch.update({
      where: { id },
      data: { ...dto },
      select: BRANCH_SELECT,
    });
    return toResponse(updated);
  }

  /**
   * DELETE /branches/:id — soft delete, requires `settings.delete`.
   *
   * Returns the deleted branch with 200 rather than an empty 204: Section 6.1
   * enumerates the status codes this API uses and 204 is not among them.
   */
  async remove(id: string): Promise<BranchResponse> {
    const branch = await this.findLiveOrThrow(id);

    // Beyond Section 6.4's letter, which lists only the financial-history 409.
    // Deleting the default leaves the tenant without one (FR-TEN-02) and parks an
    // `isDefault = true` row under the partial unique index where no live branch
    // can take its place — so the tenant could never set a default again.
    if (branch.isDefault) {
      throw new ConflictException(
        'The default branch cannot be deleted. Promote another branch to ' +
          'default first, then delete this one.',
      );
    }

    // Section 6.4: 409 if any Order or StockAdjustment references this branch.
    // Both are financial history, and BR-03 forbids destroying it — so the branch
    // those records point at has to keep existing. `isActive: false` via PATCH is
    // the supported way to retire such a branch.
    const [orderCount, adjustmentCount] = await Promise.all([
      this.prisma.db.order.count({ where: { branchId: id } }),
      this.prisma.db.stockAdjustment.count({ where: { branchId: id } }),
    ]);

    if (orderCount > 0 || adjustmentCount > 0) {
      throw new ConflictException(
        `This branch has financial history (${orderCount} order(s), ` +
          `${adjustmentCount} stock adjustment(s)) and cannot be deleted. ` +
          'Deactivate it instead: PATCH it with isActive: false.',
      );
    }

    const deleted = await this.prisma.db.branch.update({
      where: { id },
      data: { deletedAt: new Date() },
      select: BRANCH_SELECT,
    });
    return toResponse(deleted);
  }

  /**
   * A live branch in the caller's tenant, or 404.
   *
   * `findFirst` is tenant-scoped, so another tenant's id simply yields nothing and
   * the caller gets 404 — not 403, which would confirm the row exists.
   */
  private async findLiveOrThrow(id: string): Promise<BranchRow> {
    const branch = await this.prisma.db.branch.findFirst({
      where: { id, deletedAt: null },
      select: BRANCH_SELECT,
    });

    if (!branch) {
      throw new NotFoundException(`No branch ${id} exists in this tenant.`);
    }
    return branch;
  }
}

function toResponse(row: BranchRow): BranchResponse {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    isDefault: row.isDefault,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
