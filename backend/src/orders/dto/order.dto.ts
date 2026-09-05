import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { IsMoneyMinor } from '../../common/validation/money';
import { IsOptionalDateQuery } from '../../common/validation/query-filters';

/**
 * Section 6.7 — orders.
 *
 * Two things are deliberately absent from `CreateOrderDto`, and both are the
 * point of the section:
 *
 *   1. **No totals.** `subtotalCents`, `taxAmountCents` and `totalCents` are
 *      computed by the server from the lines and `taxRateBps`. Section 6.7 says a
 *      client that submits them has them "silently ignored"; this DTO does not
 *      declare them, and the global pipe runs `forbidNonWhitelisted`, so the
 *      request is refused with a 422 naming the field instead.
 *
 *      That is a deliberate departure from the section's wording (DEBT-025). A
 *      silent ignore answers `201` to a client that submitted `totalCents: 5000`,
 *      which that client will reasonably read as "the server accepted my total" —
 *      on the one record BR-03 forbids correcting afterwards. Refusing loudly is
 *      the behaviour the rest of the codebase already has for exactly this reason
 *      (see `UpdateProductDto` and `stock`).
 *
 *   2. **No `unitPriceCents`.** The price is snapshotted from `Product.priceCents`
 *      at creation, so the client cannot name its own. A POS that could would be a
 *      discount mechanism with no audit trail.
 *
 * `status` is absent too: `Pending` is the only status a new order can have, the
 * transition to `Completed` is its own endpoint, and `Refunded` is a side effect
 * of a refund and never client-writable.
 */

/** `Order.paymentMethod` — the schema's documented set. */
export const PAYMENT_METHODS = ['Cash', 'Card', 'Mobile'] as const;

/** `Order.status`. Only `Pending` is assignable at creation. */
export const ORDER_STATUSES = ['Pending', 'Completed', 'Refunded'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * 100.00% in basis points. A tax rate above par is not a rate this system should
 * accept by accident — and because the rate is frozen onto the order with the
 * total it produced, an implausible one cannot be corrected later (BR-03).
 */
export const MAX_TAX_RATE_BPS = 10_000;

/**
 * Payload guards. Neither is a business rule — they bound the work a single
 * request can ask for, so a malformed or hostile body is a 422 rather than a
 * transaction holding row locks on thousands of products.
 */
export const MAX_ORDER_LINES = 500;
export const MAX_LINE_QUANTITY = 1_000_000;

export interface OrderLineResponse {
  id: string;
  productId: string;
  /** `productNameSnapshot` — the name as it read when sold (BR-10). */
  productName: string;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
}

export interface RefundResponse {
  id: string;
  orderId: string;
  amountCents: number;
  reason: string;
  createdByUserId: string;
  createdAt: string;
}

export interface OrderResponse {
  id: string;
  orderNumber: string;
  date: string;
  branchId: string;
  customerId: string | null;
  /**
   * The customer's **current** name, joined on the list query; `null` for a
   * walk-in sale.
   *
   * Added beyond Section 6.7's field list because without it a sales history
   * cannot name the buyer, and the only alternative is a `GET /customers/:id` per
   * row — an N+1 on the busiest read in the product. It is deliberately *not* a
   * snapshot like `OrderLineResponse.productName`: a receipt must keep saying what
   * it said when it printed, but "whose order is this" should follow a rename,
   * because a renamed customer is the same customer.
   */
  customerName: string | null;
  /**
   * Number of lines on the order, so a list can show an item count without
   * fetching the lines it would otherwise have to load and discard.
   *
   * Lines, not units: `2` here means two distinct products, not two items sold.
   */
  lineCount: number;
  paymentMethod: string;
  status: OrderStatus;
  taxRateBps: number;
  subtotalCents: number;
  taxAmountCents: number;
  totalCents: number;
  createdAt: string;
  updatedAt: string;
}

export interface OrderDetailResponse extends OrderResponse {
  lines: OrderLineResponse[];
  refunds: RefundResponse[];
  /**
   * Sum of `refunds[].amountCents`, computed server-side.
   *
   * `status: 'Refunded'` only means at least one refund exists — Section 6.7 is
   * explicit that it does not mean fully refunded — so a client cannot tell the
   * two apart without this. Computing it here keeps the detail view, a report and
   * the refund form from each summing it differently.
   */
  refundedCents: number;
}

export class OrderListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(ORDER_STATUSES)
  status?: OrderStatus;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  /** Section 6.7: unblocks the branch filtering the Reports module marked blocked. */
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptionalDateQuery()
  dateFrom?: string;

  @IsOptionalDateQuery()
  dateTo?: string;
}

export class CreateOrderLineDto {
  @IsUUID()
  productId!: string;

  @IsInt()
  @Min(1, { message: 'quantity must be at least 1' })
  @Max(MAX_LINE_QUANTITY)
  quantity!: number;
}

export class CreateOrderDto {
  /**
   * Omit for a walk-in sale. `null` is accepted as the same thing so a form that
   * clears its customer field does not have to strip the key to mean "nobody".
   */
  @IsOptional()
  @IsUUID()
  customerId?: string | null;

  @IsUUID()
  branchId!: string;

  @IsIn(PAYMENT_METHODS)
  paymentMethod!: string;

  /**
   * Omit to use the tenant's configured `defaultTaxRateBps` (Section 6.4,
   * DEBT-008). Falling back to the tenant setting rather than to 0 is deliberate:
   * a client that forgets the field should get the tenant's real rate, not a
   * silently untaxed order that BR-03 then freezes. An explicit value always
   * wins — including an explicit `0`, which is how a zero-rated sale is recorded.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_TAX_RATE_BPS)
  taxRateBps?: number;

  @IsArray()
  @ArrayMinSize(1, { message: 'An order must have at least one line' })
  @ArrayMaxSize(MAX_ORDER_LINES)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderLineDto)
  lines!: CreateOrderLineDto[];
}

/**
 * PATCH /orders/:id/status.
 *
 * `Completed` is the only accepted value. `Pending` would be a no-op or a
 * reversal of a completed sale, and `Refunded` belongs to the refund endpoint —
 * both are refused by `@IsIn` before the service sees them, so the service's
 * status checks only ever handle the transition that is legal to ask for.
 */
export class UpdateOrderStatusDto {
  @IsIn(['Completed'], {
    message:
      'status must be "Completed". Refunds go through POST /orders/:id/refund; ' +
      'no endpoint returns an order to Pending (BR-03).',
  })
  status!: 'Completed';
}

export class CreateRefundDto {
  /**
   * May be less than the order total (partial refund), and several refunds may be
   * taken against one order — but their sum may not exceed it. See
   * `OrdersService.refund`.
   */
  @IsMoneyMinor()
  amountCents!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
