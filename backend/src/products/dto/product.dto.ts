import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { IsCents } from '../../common/validation/money';
import {
  IsOptionalBooleanQuery,
  IsOptionalSearchQuery,
} from '../../common/validation/query-filters';

/**
 * Mirrors `src/lib/validation/inventory.ts` (`productSchema`) — with one
 * deliberate difference, and it is the point of this section.
 *
 * That schema has `price` and `cost` as floats (`z.coerce.number()`), matching
 * `MOCK_PRODUCTS`, where a mouse costs `29.99`. The columns are `priceCents` and
 * `costCents` (`Int`, DEBT-012). This DTO takes the *cents*, so a caller that has
 * not converted gets a 422 naming the field instead of a row that is off by two
 * orders of magnitude. See `common/validation/money.ts` for why rounding-on-input
 * is refused rather than offered.
 *
 * `stock` is absent from both create and update on purpose — see below.
 */

export interface ProductResponse {
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
  /** `stock <= reorderPoint`, computed server-side so every client agrees. */
  isLowStock: boolean;
  createdAt: string;
  updatedAt: string;
}

export class ProductListQueryDto extends PaginationQueryDto {
  @IsOptionalBooleanQuery()
  isActive?: boolean;

  /** Section 6.6: `?search=`. Matched against name and SKU. */
  @IsOptionalSearchQuery()
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  /**
   * `?lowStock=true` — Section 6.6 defines it as `stock <= reorderPoint`.
   *
   * `?lowStock=false` is honoured as the complement (`stock > reorderPoint`)
   * rather than ignored, because a filter that silently does nothing for one of
   * its two legal values is worse than one that does not exist.
   */
  @IsOptionalBooleanQuery()
  lowStock?: boolean;
}

export class CreateProductDto {
  @IsString()
  @MinLength(2, { message: 'Name must be at least 2 characters' })
  @MaxLength(200)
  name!: string;

  /** Zod requires min 3; `@@unique([tenantId, sku])` makes it the trade identifier. */
  @IsString()
  @MinLength(3, { message: 'SKU must be at least 3 characters' })
  @MaxLength(64)
  sku!: string;

  @IsString()
  @MinLength(1, { message: 'Category is required' })
  @MaxLength(100)
  category!: string;

  @IsCents()
  priceCents!: number;

  @IsCents()
  costCents!: number;

  @IsString()
  @MinLength(1, { message: 'Unit of measure is required' })
  @MaxLength(32)
  uom!: string;

  @IsInt()
  @Min(0, { message: 'Reorder point must be 0 or greater' })
  reorderPoint!: number;

  /**
   * The Zod schema's creation-only `initialStock`, and the only way stock is ever
   * set through this module.
   *
   * It defaults to 0, which is also the recommended value: a non-zero opening
   * balance written here leaves no StockAdjustment row explaining where the goods
   * came from, so the audit trail starts mid-story. Section 6.8's
   * `POST /inventory/adjustments` with reason `Received` is the auditable way in.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  initialStock?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/**
 * PATCH body — metadata only.
 *
 * `stock` is deliberately absent. Section 6.6: "`stock` is not writable here.
 * Stock changes go through `POST /inventory/adjustments` (6.8) so every change is
 * audited." Under `forbidNonWhitelisted` an attempt to send it is a 422 rather
 * than a silently dropped field, so a client cannot believe it moved stock when it
 * did not. That refusal is the entire reason the inventory count is trustworthy:
 * one writer, every change carrying a reason code.
 */
export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Name must be at least 2 characters' })
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(3, { message: 'SKU must be at least 3 characters' })
  @MaxLength(64)
  sku?: string;

  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Category is required' })
  @MaxLength(100)
  category?: string;

  @IsOptional()
  @IsCents()
  priceCents?: number;

  @IsOptional()
  @IsCents()
  costCents?: number;

  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Unit of measure is required' })
  @MaxLength(32)
  uom?: string;

  @IsOptional()
  @IsInt()
  @Min(0, { message: 'Reorder point must be 0 or greater' })
  reorderPoint?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
