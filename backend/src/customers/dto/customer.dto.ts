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
 * Section 6.6 requires these bodies to mirror the frontend's Zod schemas
 * (`src/lib/validation/customers.ts`). `name` min 2 and a valid `email` come
 * straight from there. The `MaxLength` caps do not: the columns are Postgres
 * `text` and the Zod schema is unbounded, so these are the server refusing to
 * store an unbounded string, not a schema requirement being mirrored.
 */

export interface CustomerResponse {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * One row of a customer's order history.
 *
 * `totalCents` keeps its unit in its name — this is the wire format, and Section
 * 6.6's whole hazard is a float sneaking into a money field (see
 * `common/validation/money.ts`).
 */
export interface CustomerOrderSummary {
  id: string;
  orderNumber: string;
  date: string;
  status: string;
  totalCents: number;
}

/**
 * `GET /customers/:id` — detail plus order history.
 *
 * The history is a real `Order.customerId` FK query, which is what resolves
 * DEBT-004: the frontend currently matches orders to customers by comparing
 * name strings, so two customers sharing a name see each other's purchases and a
 * renamed customer loses their own.
 */
export interface CustomerDetailResponse extends CustomerResponse {
  orders: PaginatedEnvelope<CustomerOrderSummary>;
}

export class CustomerListQueryDto extends PaginationQueryDto {
  @IsOptionalBooleanQuery()
  isActive?: boolean;

  /** Section 6.6: "matches name or email". */
  @IsOptionalSearchQuery()
  search?: string;
}

/**
 * `GET /customers/:id` pagination applies to the embedded order history — the
 * detail itself is a single record, so there is nothing else on the endpoint for
 * `pageIndex`/`pageSize` to mean.
 */
export class CustomerDetailQueryDto extends PaginationQueryDto {}

export class CreateCustomerDto {
  @IsString()
  @MinLength(2, { message: 'Name must be at least 2 characters' })
  @MaxLength(200)
  name!: string;

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
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/**
 * Every field optional, and an omitted field means "leave it alone" rather than
 * "clear it" — that is what makes this a PATCH. Section 6.6 calls it a partial
 * update.
 */
export class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Name must be at least 2 characters' })
  @MaxLength(200)
  name?: string;

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
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
