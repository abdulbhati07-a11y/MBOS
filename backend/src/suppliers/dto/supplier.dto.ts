import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  PaginatedEnvelope,
  PaginationQueryDto,
} from '../../common/dto/pagination.dto';
import {
  IsOptionalBooleanQuery,
  IsOptionalSearchQuery,
} from '../../common/validation/query-filters';

/**
 * Mirrors `src/lib/validation/purchases.ts` (`supplierSchema`): `name` and
 * `contactPerson` min 2, valid `email`, the rest optional.
 *
 * `contactPerson` is required by the Zod schema but the column has `@default("")`,
 * so the two disagree. The schema wins for a create — a supplier you cannot phone
 * is not much of a supplier — while the column default keeps rows written by
 * seeds and future imports valid.
 */

export interface SupplierResponse {
  id: string;
  name: string;
  contactPerson: string;
  email: string;
  phone: string;
  address: string;
  /** Free-text, comma-separated pending a real taxonomy (DEBT-005). */
  categories: string;
  notes: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * One row of a supplier's purchase-order history. Money is minor units — paisa
 * under the default PKR (`common/validation/money.ts`, DEBT-023).
 */
export interface SupplierPurchaseOrderSummary {
  id: string;
  poNumber: string;
  date: string;
  status: string;
  totalCents: number;
}

/**
 * `GET /suppliers/:id` — detail plus PO history.
 *
 * The history filters on `PurchaseOrder.supplierId`, the real FK, replacing the
 * `supplierName` string match (PROV-FR-PUR-03, DEBT-003).
 */
export interface SupplierDetailResponse extends SupplierResponse {
  purchaseOrders: PaginatedEnvelope<SupplierPurchaseOrderSummary>;
}

export class SupplierListQueryDto extends PaginationQueryDto {
  @IsOptionalBooleanQuery()
  isActive?: boolean;

  /** Section 6.6 gives suppliers the same shape as customers: name or email. */
  @IsOptionalSearchQuery()
  search?: string;
}

/** Pagination applies to the embedded PO history — the detail is one record. */
export class SupplierDetailQueryDto extends PaginationQueryDto {}

export class CreateSupplierDto {
  @IsString()
  @MinLength(2, { message: 'Company name must be at least 2 characters' })
  @MaxLength(200)
  name!: string;

  @IsString()
  @MinLength(2, { message: 'Contact name must be at least 2 characters' })
  @MaxLength(200)
  contactPerson!: string;

  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  categories?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateSupplierDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Company name must be at least 2 characters' })
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Contact name must be at least 2 characters' })
  @MaxLength(200)
  contactPerson?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  categories?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
