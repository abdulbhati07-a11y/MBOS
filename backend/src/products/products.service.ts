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
import { TenantContextService } from '../tenancy/tenant-context.service';
import { EmbeddingService } from '../ai/embedding.service';
import {
  CreateProductDto,
  ProductListQueryDto,
  ProductResponse,
  UpdateProductDto,
} from './dto/product.dto';

const PRODUCT_SELECT = {
  id: true,
  name: true,
  sku: true,
  category: true,
  priceCents: true,
  costCents: true,
  stock: true,
  reorderPoint: true,
  uom: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

type ProductRow = {
  id: string;
  name: string;
  sku: string;
  category: string;
  priceCents: number;
  costCents: number;
  stock: number;
  reorderPoint: number;
  uom: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Section 6.6 — products.
 *
 * Two rules here are not shared with customers or suppliers, and both exist to
 * keep records that other modules depend on from being quietly falsified:
 *
 *   1. `stock` is never written by this service. The DTO has no field for it and
 *      nothing below sets it except `create`, from `initialStock`. Every later
 *      change belongs to Section 6.8's audited adjustment endpoint.
 *   2. `remove` refuses a product that appears on an order or a purchase order.
 *      See the note on `remove` — this follows the section as written, and the
 *      section is arguably wrong (DEBT-022).
 */
@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly embedding: EmbeddingService,
  ) {}

  /** GET /products — `?category=`, `?lowStock=`, `?search=`, `?isActive=`. */
  async list(
    query: ProductListQueryDto,
  ): Promise<PaginatedEnvelope<ProductResponse>> {
    const page = resolvePagination(query);
    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
      ...(query.category === undefined ? {} : { category: query.category }),
      ...this.lowStockFilter(query.lowStock),
      // SKU rather than email: searching inventory by part number is the common
      // case at a counter, and the compile-time column check is what makes
      // swapping the field list here safe.
      ...searchAny<Prisma.ProductWhereInput>(query.search, ['name', 'sku']),
    };

    const [rows, total] = await Promise.all([
      this.prisma.db.product.findMany({
        where,
        select: PRODUCT_SELECT,
        orderBy: { name: 'asc' },
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.db.product.count({ where }),
    ]);

    return paginate(rows.map(toResponse), total, page);
  }

  async findOne(id: string): Promise<ProductResponse> {
    return toResponse(await this.findLiveOrThrow(id));
  }

  /**
   * POST /products. Revives a soft-deleted product holding the SKU, because
   * `@@unique([tenantId, sku])` counts it and the SKU would otherwise be retired
   * permanently — for a part number that a supplier still sells, that is wrong.
   *
   * Stock is NOT reset on revive: it is whatever the last audited adjustment left,
   * and rewriting it here would silently contradict the StockAdjustment ledger.
   * `initialStock` is honoured only when the row is genuinely new.
   */
  async create(dto: CreateProductDto): Promise<ProductResponse> {
    const sku = dto.sku.trim();

    const existing = await this.prisma.db.product.findFirst({
      where: { sku },
      select: { id: true, deletedAt: true },
    });

    if (existing && existing.deletedAt === null) {
      throw new ConflictException(`A product with SKU ${sku} already exists.`);
    }

    const data = {
      name: dto.name.trim(),
      sku,
      category: dto.category.trim(),
      priceCents: dto.priceCents,
      costCents: dto.costCents,
      reorderPoint: dto.reorderPoint,
      uom: dto.uom.trim(),
      isActive: dto.isActive ?? true,
    };

    if (existing) {
      const revived = await this.prisma.db.product.update({
        where: { id: existing.id },
        data: { ...data, deletedAt: null },
        select: PRODUCT_SELECT,
      });
      // Detached Smart Search sync (post-commit, fail-soft — see
      // EmbeddingService). Not awaited: the create response must not wait on a
      // network embedding call. Tracked, not abandoned — EmbeddingService
      // drains outstanding work on shutdown.
      this.embedding.syncProductDetached(
        this.tenantContext.getTenantId() ?? '',
        revived,
      );
      return toResponse(revived);
    }

    const created = await this.prisma.db.product.create({
      // tenantId injected by the scope extension (see SettingsService).
      data: {
        ...data,
        stock: dto.initialStock ?? 0,
      } as Prisma.ProductUncheckedCreateInput,
      select: PRODUCT_SELECT,
    });
    this.embedding.syncProductDetached(
      this.tenantContext.getTenantId() ?? '',
      created,
    );
    return toResponse(created);
  }

  /** PATCH /products/:id — metadata only; `stock` is not accepted (Section 6.6). */
  async update(id: string, dto: UpdateProductDto): Promise<ProductResponse> {
    await this.findLiveOrThrow(id);
    const sku = dto.sku?.trim();

    if (sku !== undefined) {
      const clash = await this.prisma.db.product.findFirst({
        where: { sku, id: { not: id }, deletedAt: null },
        select: { id: true },
      });
      if (clash) {
        throw new ConflictException(
          `Another product already uses the SKU ${sku}.`,
        );
      }
    }

    const updated = await this.prisma.db.product.update({
      where: { id },
      data: {
        ...(dto.name === undefined ? {} : { name: dto.name.trim() }),
        ...(sku === undefined ? {} : { sku }),
        ...(dto.category === undefined
          ? {}
          : { category: dto.category.trim() }),
        ...(dto.priceCents === undefined ? {} : { priceCents: dto.priceCents }),
        ...(dto.costCents === undefined ? {} : { costCents: dto.costCents }),
        ...(dto.uom === undefined ? {} : { uom: dto.uom.trim() }),
        ...(dto.reorderPoint === undefined
          ? {}
          : { reorderPoint: dto.reorderPoint }),
        ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }),
      },
      select: PRODUCT_SELECT,
    });
    // Text fields may have changed; keep the embedding in step (fail-soft,
    // post-commit — see EmbeddingService).
    this.embedding.syncProductDetached(
      this.tenantContext.getTenantId() ?? '',
      updated,
    );
    return toResponse(updated);
  }

  /**
   * DELETE /products/:id — soft delete, 409 if the product has trading history.
   *
   * Implemented exactly as Section 6.6 specifies ("returns 409 if product has
   * OrderLine or POLine history"). I think the section is wrong and have filed
   * DEBT-022 rather than quietly departing from it: any product worth
   * discontinuing has almost certainly been sold, so this makes the endpoint
   * unusable for its main purpose, and the history it protects is already safe —
   * the row survives a soft delete, and both line tables additionally carry
   * `productNameSnapshot`. Deactivating (`PATCH { isActive: false }`) is the
   * working alternative, so the message says so.
   */
  async remove(id: string): Promise<ProductResponse> {
    await this.findLiveOrThrow(id);

    // OrderLine and POLine have no tenantId and are excluded from SCOPED_MODELS —
    // they are isolated through their parent's scoped FK. Filtering by this
    // productId is safe because the product above was already proven to belong to
    // the caller's tenant, so no row reachable here belongs to another one.
    const [orderLines, poLines] = await Promise.all([
      this.prisma.db.orderLine.count({ where: { productId: id } }),
      this.prisma.db.pOLine.count({ where: { productId: id } }),
    ]);

    if (orderLines > 0 || poLines > 0) {
      throw new ConflictException(
        `Product ${id} cannot be deleted: it appears on ${orderLines} order ` +
          `line(s) and ${poLines} purchase-order line(s). Set isActive to false ` +
          'to withdraw it from sale while keeping its trading history.',
      );
    }

    const deleted = await this.prisma.db.product.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
      select: PRODUCT_SELECT,
    });
    // The product left the searchable catalogue; drop its vector so the HNSW
    // index stays free of dead rows (fail-soft, post-commit).
    this.embedding.clearProductDetached(
      this.tenantContext.getTenantId() ?? '',
      id,
    );
    return toResponse(deleted);
  }

  /**
   * `?lowStock=` compares two columns, which needs a Prisma field reference —
   * `stock <= reorderPoint` cannot be expressed with a literal, and doing it in
   * JavaScript would mean paginating over rows the database had not filtered, so
   * `pagination.total` would be a lie.
   *
   * The reference is taken from the raw client because it is model metadata, not a
   * query: the extended client rewrites arguments, and `.fields` is not part of
   * what an extension is guaranteed to re-expose. The query itself still runs on
   * `db`, so tenant scoping is unaffected.
   */
  private lowStockFilter(lowStock?: boolean): Prisma.ProductWhereInput {
    if (lowStock === undefined) return {};
    const reorderPoint = this.prisma.product.fields.reorderPoint;
    return lowStock
      ? { stock: { lte: reorderPoint } }
      : { stock: { gt: reorderPoint } };
  }

  private async findLiveOrThrow(id: string): Promise<ProductRow> {
    const product = await this.prisma.db.product.findFirst({
      where: { id, deletedAt: null },
      select: PRODUCT_SELECT,
    });

    if (!product) {
      throw new NotFoundException(`No product ${id} exists in this tenant.`);
    }
    return product;
  }
}

function toResponse(row: ProductRow): ProductResponse {
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    category: row.category,
    priceCents: row.priceCents,
    costCents: row.costCents,
    stock: row.stock,
    reorderPoint: row.reorderPoint,
    uom: row.uom,
    isActive: row.isActive,
    // Computed here rather than left to each client: the frontend, a report and
    // the reorder list must not be able to disagree about what "low" means.
    isLowStock: row.stock <= row.reorderPoint,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
