import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { visibleRoleWhere } from '../access-control/role-visibility';
import { PasswordService } from '../auth/password.service';
import {
  PaginatedEnvelope,
  paginate,
  resolvePagination,
} from '../common/dto/pagination.dto';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import {
  CreateUserDto,
  UpdateUserDto,
  UserListQueryDto,
  UserResponse,
} from './dto/user.dto';

const USER_SELECT = {
  id: true,
  email: true,
  roleId: true,
  isActive: true,
  mfaEnabled: true,
  createdAt: true,
  updatedAt: true,
  role: { select: { name: true } },
} as const;

type UserRow = {
  id: string;
  email: string;
  roleId: string;
  isActive: boolean;
  mfaEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  role: { name: string };
};

/**
 * Section 6.5 — user management.
 *
 * `User` IS tenant-scoped, so unlike RolesService these queries let the extension
 * supply `tenantId`. Only two things need stating by hand: `deletedAt: null`,
 * which the extension does not add, and the role check in `assertRoleAssignable`,
 * because Role is unscoped.
 *
 * Three rules protect the caller from locking themselves or the tenant out. Only
 * the first is in Section 6.5; the other two follow from D-02 and FR-TEN-02's
 * shape, and each is a 403 with an explanation rather than a silent success.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /** GET /users — paginated, optional `?isActive=`. */
  async list(
    query: UserListQueryDto,
  ): Promise<PaginatedEnvelope<UserResponse>> {
    const page = resolvePagination(query);
    const where = {
      deletedAt: null,
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
    };

    const [rows, total] = await Promise.all([
      this.prisma.db.user.findMany({
        where,
        select: USER_SELECT,
        orderBy: { email: 'asc' },
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.db.user.count({ where }),
    ]);

    return paginate(rows.map(toResponse), total, page);
  }

  /**
   * POST /users.
   *
   * A soft-deleted user holding the same address is revived rather than rejected:
   * `@@unique([tenantId, email])` still counts that row, so the address would
   * otherwise be unusable forever. The revive resets the password, role, and
   * active flag from this request, so nothing carries over from the previous
   * occupant of the address — importantly not the old password hash.
   */
  async create(dto: CreateUserDto): Promise<UserResponse> {
    const email = dto.email.trim().toLowerCase();
    await this.assertRoleAssignable(dto.roleId);

    const existing = await this.prisma.db.user.findFirst({
      where: { email },
      select: { id: true, deletedAt: true },
    });

    if (existing && existing.deletedAt === null) {
      throw new ConflictException(`A user with email ${email} already exists.`);
    }

    const passwordHash = await this.passwords.hash(dto.password);

    if (existing) {
      const revived = await this.prisma.db.user.update({
        where: { id: existing.id },
        data: {
          passwordHash,
          roleId: dto.roleId,
          isActive: dto.isActive ?? true,
          deletedAt: null,
          // A returning address must not inherit the previous holder's second
          // factor: the secret belongs to whoever enrolled it, and they are gone.
          mfaEnabled: false,
          mfaSecret: null,
        },
        select: USER_SELECT,
      });
      return toResponse(revived);
    }

    const created = await this.prisma.db.user.create({
      // tenantId is injected by the scope extension; extensions rewrite arguments
      // but not input types, hence the Unchecked shape (see SettingsService).
      data: {
        email,
        passwordHash,
        roleId: dto.roleId,
        isActive: dto.isActive ?? true,
      } as Prisma.UserUncheckedCreateInput,
      select: USER_SELECT,
    });
    return toResponse(created);
  }

  /**
   * PATCH /users/:id — identity and role assignment.
   *
   * Deactivating or re-roling yourself is refused. Section 6.5 only forbids
   * deleting yourself, but an Owner who removes their own `settings.write` — by
   * switching to Cashier or setting `isActive: false` — loses the very permission
   * needed to undo it, and with no other Owner the tenant is locked out of its own
   * administration. The escape hatch is another Owner doing it.
   */
  async update(id: string, dto: UpdateUserDto): Promise<UserResponse> {
    await this.findLiveOrThrow(id);
    const callerId = this.requireUserId();

    if (id === callerId && dto.roleId !== undefined) {
      throw new ForbiddenException(
        'You cannot change your own role. Another Owner must do it, so a ' +
          'tenant cannot lock itself out of its own administration.',
      );
    }

    if (id === callerId && dto.isActive === false) {
      throw new ForbiddenException(
        'You cannot deactivate your own account. Another Owner must do it.',
      );
    }

    if (dto.roleId !== undefined) {
      await this.assertRoleAssignable(dto.roleId);
    }

    const email = dto.email?.trim().toLowerCase();

    if (email !== undefined) {
      const clash = await this.prisma.db.user.findFirst({
        where: { email, id: { not: id }, deletedAt: null },
        select: { id: true },
      });
      if (clash) {
        throw new ConflictException(
          `Another user already uses the email ${email}.`,
        );
      }
    }

    const updated = await this.prisma.db.user.update({
      where: { id },
      data: {
        ...(email === undefined ? {} : { email }),
        ...(dto.roleId === undefined ? {} : { roleId: dto.roleId }),
        ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }),
      },
      select: USER_SELECT,
    });
    return toResponse(updated);
  }

  /**
   * DELETE /users/:id — soft delete. Section 6.5: cannot delete self.
   *
   * Refresh tokens are revoked in the same transaction. Without that, a deleted
   * user's outstanding refresh token would keep minting access tokens: the auth
   * guard reads the token, not the user row, so the account would stay usable
   * until the token expired on its own.
   */
  async remove(id: string): Promise<UserResponse> {
    await this.findLiveOrThrow(id);

    if (id === this.requireUserId()) {
      throw new ForbiddenException(
        'You cannot delete your own account. Another Owner must do it.',
      );
    }

    // Both operations come from the SAME client. `$transaction` takes promises
    // from one client, and `this.prisma` (raw) and `this.prisma.db` (extended) are
    // two different instances — mixing them would step outside the transaction.
    // The extended client is safe for RefreshToken: the scope extension passes
    // through any model not in SCOPED_MODELS, and RefreshToken is excluded
    // (it is keyed by userId and read before tenant context exists).
    const [, deleted] = await this.prisma.db.$transaction([
      this.prisma.db.refreshToken.deleteMany({ where: { userId: id } }),
      this.prisma.db.user.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false },
        select: USER_SELECT,
      }),
    ]);

    return toResponse(deleted);
  }

  /**
   * A role must be a global built-in or one of this tenant's own, and not
   * soft-deleted — the shared `visibleRoleWhere` filter, not a second copy of it.
   *
   * Without this check, `roleId` is a client-supplied UUID that could assign
   * another tenant's custom role, and PermissionGuard would then refuse every
   * request from that user — a lockout delivered by a 201 response.
   */
  private async assertRoleAssignable(roleId: string): Promise<void> {
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, ...visibleRoleWhere(this.requireTenantId()) },
      select: { id: true },
    });

    if (!role) {
      // 422, not 404: the body is what is wrong, and the resource being addressed
      // (the user) is not the thing that is missing. Section 6.1 assigns 422 to a
      // body that parses but fails validation.
      throw new UnprocessableEntityException(
        `Role ${roleId} is not available to this tenant. Assign a built-in ` +
          "role or one of this tenant's own custom roles.",
      );
    }
  }

  private async findLiveOrThrow(id: string): Promise<UserRow> {
    const user = await this.prisma.db.user.findFirst({
      where: { id, deletedAt: null },
      select: USER_SELECT,
    });

    if (!user) {
      throw new NotFoundException(`No user ${id} exists in this tenant.`);
    }
    return user;
  }

  private requireTenantId(): string {
    const tenantId = this.tenantContext.getTenantId();
    if (!tenantId) {
      throw new Error('UsersService ran outside a request context.');
    }
    return tenantId;
  }

  private requireUserId(): string {
    const userId = this.tenantContext.get()?.userId;
    if (!userId) {
      throw new Error(
        'UsersService could not identify the caller. The self-protection rules ' +
          'depend on it, so proceeding without it is not safe.',
      );
    }
    return userId;
  }
}

function toResponse(row: UserRow): UserResponse {
  return {
    id: row.id,
    email: row.email,
    roleId: row.roleId,
    roleName: row.role.name,
    isActive: row.isActive,
    mfaEnabled: row.mfaEnabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
