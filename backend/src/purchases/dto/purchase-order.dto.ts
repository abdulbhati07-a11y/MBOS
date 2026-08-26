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
 * Section 6.9 — purchase orders.
 *
 * The shape mirrors `CreateOrderDto` (Section 6.7) because the two are the same
 * kind of document — a header with snapshotted lines whose money the server
 * owns — but they differ on one field, and the difference is the point:
 *
 *   - An **order** line carries no price. It is snapshotted from
 *     `Product.priceCents`, because a till that could name its own price is an
 *     undocumented discount mechanism.
 *   - A **PO** line carries `unitCostCents`, and must. Section 6.9 is explicit
 *     that this is the buyer-negotiated cost, "independent of
 *     `Product.costCents`" — a supplier quotes what a supplier quotes, and the
 *     catalogue cost is a different number that this does not touch. Refusing it
 *     would make every PO wrong at the moment a price was agreed.
 *
 * Absent for the same reasons as on orders: `subtotalCents` and `totalCents`
 * (server-computed from the lines — BR-05, and locked after creation by BR-03),
 * `supplierNameSnapshot` (Section 6.9 says the server reads `Supplier.name` at
 * creation time), `poNumber` (allocated server-side), and `status` (`Draft` is
 * the only status a new PO can hold; moving it is `PATCH /:id/status`).
 *
 * `forbidNonWhitelisted` is on globally, so submitting any of them is a 422
 * naming the field rather than a silent ignore — the same DEBT-025 reasoning
 * that shaped `CreateOrderDto`.
 */

/** `PurchaseOrder.status` — the schema's documented set. */
export const PO_STATUSES = ['Draft', 'Sent', 'Received', 'Cancelled'] as const;
export type POStatus = (typeof PO_STATUSES)[number];

/**
 * The PO state machine, Section 6.9's map verbatim.
 *
 * This is the server-side half of DEBT-002. The frontend holds the same map in
 * `src/lib/mock-data/purchase-orders.ts` and uses it to decide which buttons to
 * render; that copy is a UX affordance and nothing more. This one is the rule —
 * it is checked against the PO's *current stored* status, so a client that sends
 * a transition its own map would have hidden is still refused.
 *
 * `Received` and `Cancelled` are terminal, and their empty arrays are the whole
 * statement of that: goods that arrived did arrive, and BR-03 gives no path back
 * from either. A PO that was cancelled by mistake is re-raised as a new PO.
 */
export const PO_TRANSITIONS: Readonly<Record<POStatus, readonly POStatus[]>> = {
  Draft: ['Sent', 'Cancelled'],
  Sent: ['Received', 'Cancelled'],
  Received: [],
  Cancelled: [],
};

/**
 * The `code` Section 6.9 specifies for a refused transition, distinct from the
 * generic `CONFLICT` a 409 would otherwise carry. `ApiExceptionFilter` reads it
 * off the thrown payload.
 */
export const INVALID_STATUS_TRANSITION = 'INVALID_STATUS_TRANSITION';

/**
 * Payload guards, matching `MAX_ORDER_LINES` / `MAX_LINE_QUANTITY` on orders.
 * Not business rules — they bound the work one request can demand, so a hostile
 * body is a 422 rather than a transaction holding locks on thousands of rows.
 */
export const MAX_PO_LINES = 500;
export const MAX_PO_LINE_QUANTITY = 1_000_000;

/** `PurchaseOrder.notes` is `String @default("")`, so this bounds it. */
export const MAX_PO_NOTES_LENGTH = 2_000;

export interface POLineResponse {
  id: string;
  productId: string;
  /** `productNameSnapshot` — the name as it read when ordered (BR-10). */
  productName: string;
  /** Buyer-negotiated. Not `Product.costCents`. */
  unitCostCents: number;
  quantity: number;
  lineTotalCents: number;
}

export interface POStatusTransitionResponse {
  id: string;
  fromStatus: POStatus;
  toStatus: POStatus;
  changedByUserId: string;
  changedAt: string;
}

export interface PurchaseOrderResponse {
  id: string;
  poNumber: string;
  date: string;
  supplierId: string;
  /**
   * `supplierNameSnapshot` — the supplier as named on the PO when it was raised.
   *
   * A snapshot, unlike `OrderResponse.customerName`, and the asymmetry is
   * deliberate. A PO is an outbound commitment: it says who was ordered from,
   * and that must keep reading as it read when it was sent, the same reason the
   * line snapshots the product name (BR-10). "Whose order is this" on a *sale*
   * is a pointer to a living customer record, so it follows a rename.
   */
  supplierName: string;
  status: POStatus;
  subtotalCents: number;
  /**
   * Equal to `subtotalCents` in every row this API writes.
   *
   * `PurchaseOrder` has no tax columns — no `taxRateBps`, no `taxAmountCents` —
   * unlike `Order`, which has both. So there is nothing for the server to add to
   * the subtotal, and Section 6.9's instruction to compute both from the lines
   * yields the same number twice. Both are returned rather than one, because the
   * column exists and a client reading `totalCents` should not have to know it is
   * currently redundant. Recorded as DEBT-033.
   */
  totalCents: number;
  notes: string;
  /**
   * Number of lines, so a PO list can show an item count without loading the
   * lines to discard them. Lines, not units — the same meaning as
   * `OrderResponse.lineCount`.
   */
  lineCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseOrderDetailResponse extends PurchaseOrderResponse {
  lines: POLineResponse[];
  /**
   * The status history, oldest first. Section 6.9 asks for it on the detail
   * response *and* exposes it separately at `GET /:id/transitions`; both read
   * the same rows, so a client that already has the detail need not ask again.
   */
  statusTransitions: POStatusTransitionResponse[];
}

export class PurchaseOrderListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(PO_STATUSES)
  status?: POStatus;

  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @IsOptionalDateQuery()
  dateFrom?: string;

  @IsOptionalDateQuery()
  dateTo?: string;
}

export class CreatePOLineDto {
  @IsUUID()
  productId!: string;

  /**
   * The agreed unit cost, in minor units. Required — see the file header on why
   * this is accepted here when an order line's price is not.
   */
  @IsMoneyMinor()
  unitCostCents!: number;

  @IsInt()
  @Min(1, { message: 'quantity must be at least 1' })
  @Max(MAX_PO_LINE_QUANTITY)
  quantity!: number;
}

export class CreatePurchaseOrderDto {
  @IsUUID()
  supplierId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_PO_NOTES_LENGTH)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'A purchase order must have at least one line' })
  @ArrayMaxSize(MAX_PO_LINES)
  @ValidateNested({ each: true })
  @Type(() => CreatePOLineDto)
  lines!: CreatePOLineDto[];
}

/**
 * PATCH /purchase-orders/:id/status — `{ "toStatus": "Sent" }`.
 *
 * `toStatus` rather than `status`, which is Section 6.9's own field name and
 * differs from the orders endpoint's `status`. Kept as specified: the name says
 * this is a transition request and not an assignment, which is exactly the
 * distinction `PO_TRANSITIONS` enforces.
 *
 * `@IsIn` accepts any of the four statuses, including the two terminal ones.
 * That is on purpose — whether a *particular* move is legal depends on the PO's
 * current status, which only the service can see. Validating the vocabulary here
 * and the transition there keeps a wrong-but-well-formed request a 409 naming
 * what was possible, rather than a 422 that would say only "bad value".
 */
export class UpdatePOStatusDto {
  @IsIn(PO_STATUSES)
  toStatus!: POStatus;
}
