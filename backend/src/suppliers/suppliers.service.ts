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
  CreateSupplierDto,
  SupplierDetailQueryDto,
  SupplierDetailResponse,
  SupplierListQueryDto,
  SupplierPurchaseOrderSummary,
  SupplierResponse,
  UpdateSupplierDto,
} from './dto/supplier.dto';

const SUPPLIER_SELECT = {
  id: true,
  name: true,
  contactPerson: true,
  email: true,
  phone: true,
  address: true,
  categories: true,
  notes: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

type SupplierRow = {
  id: string;
  name: string;
  contactPerson: string;
  email: string;
  phone: string;
  address: string;
  categories: string;
  notes: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Section 6.6 — suppliers, "same shape as Customers".
 *
 * Structurally parallel to CustomersService on purpose, including the
 * revive-on-reused-email rule and the explicit `deletedAt: null` the tenant-scope
 * extension does not add. The parallel is by hand: a shared base class would have
 * to be generic over two Prisma delegates whose `findFirst` overloads are not
 * structurally compatible, so it would need casts that cost more safety than the
 * duplication does. What *is* shared is the part where a silent mistake hides —
 * `searchAny`, which type-checks the column list against the model.
 */
@Injectable()
export class SuppliersService {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /suppliers — `?isActive=`, `?search=` over name and email. */
  async list(
    query: SupplierListQueryDto,
  ): Promise<PaginatedEnvelope<SupplierResponse>> {
    const page = resolvePagination(query);
    const where: Prisma.SupplierWhereInput = {
      deletedAt: null,
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
      ...searchAny<Prisma.SupplierWhereInput>(query.search, ['name', 'email']),
    };

    const [rows, total] = await Promise.all([
      this.prisma.db.supplier.findMany({
        where,
        select: SUPPLIER_SELECT,
        orderBy: { name: 'asc' },
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.db.supplier.count({ where }),
    ]);

    return paginate(rows.map(toResponse), total, page);
  }

  /**
   * GET /suppliers/:id — detail plus paginated PO history.
   *
   * Filtered on the `supplierId` FK. `PurchaseOrder` also carries
   * `supplierNameSnapshot`, which is *not* what this queries: the snapshot exists
   * so a historical PO still shows the name it was raised under after a rename,
   * while the FK is what actually associates it with this supplier (DEBT-003).
   */
  async findOne(
    id: string,
    query: SupplierDetailQueryDto,
  ): Promise<SupplierDetailResponse> {
    const supplier = await this.findLiveOrThrow(id);
    const page = resolvePagination(query);

    const where: Prisma.PurchaseOrderWhereInput = { supplierId: id };

    const [orders, total] = await Promise.all([
      this.prisma.db.purchaseOrder.findMany({
        where,
        select: {
          id: true,
          poNumber: true,
          date: true,
          status: true,
          totalCents: true,
        },
        orderBy: { date: 'desc' },
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.db.purchaseOrder.count({ where }),
    ]);

    const history: SupplierPurchaseOrderSummary[] = orders.map((order) => ({
      id: order.id,
      poNumber: order.poNumber,
      date: order.date.toISOString(),
      status: order.status,
      totalCents: order.totalCents,
    }));

    return {
      ...toResponse(supplier),
      purchaseOrders: paginate(history, total, page),
    };
  }

  /**
   * POST /suppliers. Revives a soft-deleted holder of the address, for the
   * `@@unique([tenantId, email])` reason set out in CustomersService.create.
   *
   * PO history is retained on revive, and here the case is stronger than for
   * customers: `supplierNameSnapshot` already fixes what each historical PO said,
   * so nothing about the past changes when the supplier row comes back.
   */
  async create(dto: CreateSupplierDto): Promise<SupplierResponse> {
    const email = dto.email.trim().toLowerCase();

    const existing = await this.prisma.db.supplier.findFirst({
      where: { email },
      select: { id: true, deletedAt: true },
    });

    if (existing && existing.deletedAt === null) {
      throw new ConflictException(
        `A supplier with email ${email} already exists.`,
      );
    }

    const data = {
      name: dto.name.trim(),
      contactPerson: dto.contactPerson.trim(),
      email,
      phone: dto.phone ?? '',
      address: dto.address ?? '',
      categories: dto.categories ?? '',
      notes: dto.notes ?? '',
      isActive: dto.isActive ?? true,
    };

    if (existing) {
      const revived = await this.prisma.db.supplier.update({
        where: { id: existing.id },
        data: { ...data, deletedAt: null },
        select: SUPPLIER_SELECT,
      });
      return toResponse(revived);
    }

    const created = await this.prisma.db.supplier.create({
      // tenantId injected by the scope extension (see SettingsService).
      data: data as Prisma.SupplierUncheckedCreateInput,
      select: SUPPLIER_SELECT,
    });
    return toResponse(created);
  }

  /** PATCH /suppliers/:id — partial update. */
  async update(id: string, dto: UpdateSupplierDto): Promise<SupplierResponse> {
    await this.findLiveOrThrow(id);
    const email = dto.email?.trim().toLowerCase();

    if (email !== undefined) {
      const clash = await this.prisma.db.supplier.findFirst({
        where: { email, id: { not: id }, deletedAt: null },
        select: { id: true },
      });
      if (clash) {
        throw new ConflictException(
          `Another supplier already uses the email ${email}.`,
        );
      }
    }

    const updated = await this.prisma.db.supplier.update({
      where: { id },
      data: {
        ...(dto.name === undefined ? {} : { name: dto.name.trim() }),
        ...(dto.contactPerson === undefined
          ? {}
          : { contactPerson: dto.contactPerson.trim() }),
        ...(email === undefined ? {} : { email }),
        ...(dto.phone === undefined ? {} : { phone: dto.phone }),
        ...(dto.address === undefined ? {} : { address: dto.address }),
        ...(dto.categories === undefined ? {} : { categories: dto.categories }),
        ...(dto.notes === undefined ? {} : { notes: dto.notes }),
        ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }),
      },
      select: SUPPLIER_SELECT,
    });
    return toResponse(updated);
  }

  /**
   * DELETE /suppliers/:id — soft delete.
   *
   * No history check, for the same reason as customers: `PurchaseOrder.supplierId`
   * points at this row and the row survives, so historical POs keep resolving.
   */
  async remove(id: string): Promise<SupplierResponse> {
    await this.findLiveOrThrow(id);

    const deleted = await this.prisma.db.supplier.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
      select: SUPPLIER_SELECT,
    });
    return toResponse(deleted);
  }

  private async findLiveOrThrow(id: string): Promise<SupplierRow> {
    const supplier = await this.prisma.db.supplier.findFirst({
      where: { id, deletedAt: null },
      select: SUPPLIER_SELECT,
    });

    if (!supplier) {
      throw new NotFoundException(`No supplier ${id} exists in this tenant.`);
    }
    return supplier;
  }
}

function toResponse(row: SupplierRow): SupplierResponse {
  return {
    id: row.id,
    name: row.name,
    contactPerson: row.contactPerson,
    email: row.email,
    phone: row.phone,
    address: row.address,
    categories: row.categories,
    notes: row.notes,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
