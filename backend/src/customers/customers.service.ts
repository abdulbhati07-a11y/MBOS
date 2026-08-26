import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PaginatedEnvelope,
  paginate,
  resolvePagination,
} from '../common/dto/pagination.dto';
import { searchAny } from '../common/validation/query-filters';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateCustomerDto,
  CustomerDetailQueryDto,
  CustomerDetailResponse,
  CustomerListQueryDto,
  CustomerOrderSummary,
  CustomerResponse,
  UpdateCustomerDto,
} from './dto/customer.dto';

const CUSTOMER_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  address: true,
  notes: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

type CustomerRow = {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Section 6.6 — customers.
 *
 * `Customer` is tenant-scoped, so the extension supplies `tenantId` on every
 * query here. The one thing it does not supply is `deletedAt: null` — Section 5.1
 * claims middleware appends it, and nothing does — so every read states it by
 * hand. A missing `deletedAt: null` is invisible in testing against a clean
 * database and shows up later as deleted records reappearing in a list.
 *
 * The soft-deleted-email rule below is the same one `UsersService.create` applies,
 * for the same `@@unique([tenantId, email])` reason, but it resolves differently:
 * see `create`.
 */
@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /customers — `?isActive=`, `?search=` over name and email. */
  async list(
    query: CustomerListQueryDto,
  ): Promise<PaginatedEnvelope<CustomerResponse>> {
    const page = resolvePagination(query);
    const where: Prisma.CustomerWhereInput = {
      deletedAt: null,
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
      ...searchAny<Prisma.CustomerWhereInput>(query.search, ['name', 'email']),
    };

    const [rows, total] = await Promise.all([
      this.prisma.db.customer.findMany({
        where,
        select: CUSTOMER_SELECT,
        orderBy: { name: 'asc' },
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.db.customer.count({ where }),
    ]);

    return paginate(rows.map(toResponse), total, page);
  }

  /**
   * GET /customers/:id — detail plus paginated order history.
   *
   * The history query filters on `Order.customerId`, the real FK. That is the
   * DEBT-004 resolution: the frontend currently pairs orders to customers by
   * matching name strings, so two customers named "J. Smith" see each other's
   * purchases, and renaming a customer detaches their entire history. Pagination
   * on this endpoint applies to the history, since the detail is one record.
   */
  async findOne(
    id: string,
    query: CustomerDetailQueryDto,
  ): Promise<CustomerDetailResponse> {
    const customer = await this.findLiveOrThrow(id);
    const page = resolvePagination(query);

    // Order is tenant-scoped too, so this is filtered by tenant as well as by
    // customerId — the customer was already proven to be in this tenant, but the
    // scope makes a mistake here impossible rather than merely unlikely.
    const where: Prisma.OrderWhereInput = { customerId: id };

    const [orders, total] = await Promise.all([
      this.prisma.db.order.findMany({
        where,
        select: {
          id: true,
          orderNumber: true,
          date: true,
          status: true,
          totalCents: true,
        },
        orderBy: { date: 'desc' },
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.db.order.count({ where }),
    ]);

    const history: CustomerOrderSummary[] = orders.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      date: order.date.toISOString(),
      status: order.status,
      totalCents: order.totalCents,
    }));

    return {
      ...toResponse(customer),
      orders: paginate(history, total, page),
    };
  }

  /**
   * POST /customers.
   *
   * A soft-deleted customer holding this email is revived, because
   * `@@unique([tenantId, email])` counts that row and the address would otherwise
   * be unusable forever.
   *
   * Unlike a revived *user*, a revived customer keeps their order history. That is
   * deliberate: for a customer the email address identifies the person, so the
   * same address returning is the same person coming back, and their past orders
   * are theirs. (A user address like `info@` can genuinely change hands, which is
   * why `UsersService.create` resets credentials and MFA on revive.) If a tenant
   * ever needs a truly fresh customer on a reused address, that is a distinct
   * "merge/split customer" operation, not a side effect of POST.
   */
  async create(dto: CreateCustomerDto): Promise<CustomerResponse> {
    const email = dto.email.trim().toLowerCase();

    const existing = await this.prisma.db.customer.findFirst({
      where: { email },
      select: { id: true, deletedAt: true },
    });

    if (existing && existing.deletedAt === null) {
      throw new ConflictException(
        `A customer with email ${email} already exists.`,
      );
    }

    const data = {
      name: dto.name.trim(),
      email,
      phone: dto.phone ?? '',
      address: dto.address ?? '',
      notes: dto.notes ?? '',
      isActive: dto.isActive ?? true,
    };

    if (existing) {
      const revived = await this.prisma.db.customer.update({
        where: { id: existing.id },
        data: { ...data, deletedAt: null },
        select: CUSTOMER_SELECT,
      });
      return toResponse(revived);
    }

    const created = await this.prisma.db.customer.create({
      // tenantId is injected by the scope extension; extensions rewrite arguments
      // but not input types, hence the Unchecked shape (see SettingsService).
      data: data as Prisma.CustomerUncheckedCreateInput,
      select: CUSTOMER_SELECT,
    });
    return toResponse(created);
  }

  /** PATCH /customers/:id — partial update. */
  async update(id: string, dto: UpdateCustomerDto): Promise<CustomerResponse> {
    await this.findLiveOrThrow(id);
    const email = dto.email?.trim().toLowerCase();

    if (email !== undefined) {
      // Only a *live* customer blocks the address. A soft-deleted holder does
      // not, which keeps this consistent with create's revive rule — otherwise an
      // address could be claimed by POST but not by PATCH.
      const clash = await this.prisma.db.customer.findFirst({
        where: { email, id: { not: id }, deletedAt: null },
        select: { id: true },
      });
      if (clash) {
        throw new ConflictException(
          `Another customer already uses the email ${email}.`,
        );
      }
    }

    const updated = await this.prisma.db.customer.update({
      where: { id },
      data: {
        ...(dto.name === undefined ? {} : { name: dto.name.trim() }),
        ...(email === undefined ? {} : { email }),
        ...(dto.phone === undefined ? {} : { phone: dto.phone }),
        ...(dto.address === undefined ? {} : { address: dto.address }),
        ...(dto.notes === undefined ? {} : { notes: dto.notes }),
        ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }),
      },
      select: CUSTOMER_SELECT,
    });
    return toResponse(updated);
  }

  /**
   * DELETE /customers/:id — soft delete.
   *
   * No history check, unlike products: `Order.customerId` points at this row and
   * the row survives a soft delete, so past orders keep resolving to a real
   * customer. Preserving that link is exactly what soft delete is for here.
   */
  async remove(id: string): Promise<CustomerResponse> {
    await this.findLiveOrThrow(id);

    const deleted = await this.prisma.db.customer.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
      select: CUSTOMER_SELECT,
    });
    return toResponse(deleted);
  }

  private async findLiveOrThrow(id: string): Promise<CustomerRow> {
    const customer = await this.prisma.db.customer.findFirst({
      where: { id, deletedAt: null },
      select: CUSTOMER_SELECT,
    });

    if (!customer) {
      throw new NotFoundException(`No customer ${id} exists in this tenant.`);
    }
    return customer;
  }
}

function toResponse(row: CustomerRow): CustomerResponse {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    address: row.address,
    notes: row.notes,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
