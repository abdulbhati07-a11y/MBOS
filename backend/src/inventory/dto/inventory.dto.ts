import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { IsOptionalDateQuery } from '../../common/validation/query-filters';

/**
 * Section 6.8 — inventory adjustments.
 *
 * **The one thing to understand about `quantityDelta`:** the field means
 * something different on the wire than it does in the column, and both readings
 * are correct.
 *
 *   - **On the wire** it is an unsigned magnitude, and `type` carries the sign.
 *     Section 6.8's own example is `{ "type": "REMOVE", "quantityDelta": 5 }` —
 *     positive five, on a removal. A client never sends a negative number.
 *   - **In the column** it is signed: `-5` for that same request. The schema
 *     comment says so ("positive for ADD/COUNT increase; negative for REMOVE"),
 *     and Section 6.7's completion path already writes it that way
 *     (`quantityDelta: -quantity`), so the audit log is consistent across both
 *     writers.
 *
 * The server converts between the two. That conversion is the whole reason this
 * endpoint cannot just persist its request body (DEBT-028).
 *
 * `COUNT` is the third reading: there `quantityDelta` is neither a magnitude nor
 * a delta but the **absolute new stock level**, and the stored delta is
 * `quantityDelta - currentStock` — which may be negative, positive or zero.
 */

/** `StockAdjustment.type` — the schema's documented set. */
export const ADJUSTMENT_TYPES = ['ADD', 'REMOVE', 'COUNT'] as const;
export type AdjustmentType = (typeof ADJUSTMENT_TYPES)[number];

/**
 * The reason codes a client may submit.
 *
 * `StockAdjustment.reasonCode` also permits `Sale` and `PurchaseReceived`, and
 * both are deliberately absent here: they are written by the system when an
 * order completes (Section 6.7) or a purchase order is received (Section 6.9).
 * Accepting them on this endpoint would let a user forge a sale-shaped audit row
 * with no order behind it, which is exactly the reconciliation the audit log
 * exists to make possible.
 */
export const CLIENT_REASON_CODES = [
  'Received',
  'Returned',
  'Damaged',
  'Correction',
] as const;
export type ClientReasonCode = (typeof CLIENT_REASON_CODES)[number];

/** Reason codes only the system writes. Rejected on this endpoint. */
export const SYSTEM_REASON_CODES = ['Sale', 'PurchaseReceived'] as const;

/**
 * Upper bound on a single adjustment. Chosen to keep `Product.stock` clear of
 * the int4 ceiling under any plausible sequence of adjustments rather than to
 * describe a real warehouse — a count above this is far likelier to be a
 * misplaced decimal point than a genuine delivery, and unlike an order an
 * adjustment can be corrected afterwards, so refusing costs the operator little.
 */
export const MAX_ADJUSTMENT_QUANTITY = 1_000_000;

/** `Product.stock` is `Int` — int4. Adjustments may not push it past this. */
export const MAX_STOCK = 2_147_483_647;

/** Cap on each array returned by `GET /inventory/alerts`. */
export const MAX_ALERTS = 200;

export class CreateAdjustmentDto {
  @IsUUID()
  productId!: string;

  @IsUUID()
  branchId!: string;

  @IsIn(ADJUSTMENT_TYPES)
  type!: AdjustmentType;

  /**
   * Magnitude for `ADD`/`REMOVE`, absolute new level for `COUNT`.
   *
   * `@Min(0)` rather than `@Min(1)` because zero is meaningful for `COUNT` — a
   * stock take may legitimately find nothing on the shelf. For `ADD` and
   * `REMOVE` zero is refused in the service, where the type is known.
   */
  @IsInt()
  @Min(0)
  @Max(MAX_ADJUSTMENT_QUANTITY)
  quantityDelta!: number;

  @IsIn(CLIENT_REASON_CODES)
  reasonCode!: ClientReasonCode;
}

export class AdjustmentListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsIn(ADJUSTMENT_TYPES)
  type?: AdjustmentType;

  @IsOptionalDateQuery()
  dateFrom?: string;

  @IsOptionalDateQuery()
  dateTo?: string;
}

export interface AdjustmentResponse {
  id: string;
  productId: string;
  productName: string;
  branchId: string;
  type: AdjustmentType;
  /** Signed, as stored: negative for a removal. */
  quantityDelta: number;
  reasonCode: string;
  newStockLevel: number;
  createdByUserId: string;
  createdAt: string;
}

export interface StockAlert {
  id: string;
  name: string;
  sku: string;
  stock: number;
  reorderPoint: number;
}

export interface AlertsResponse {
  outOfStock: StockAlert[];
  lowStock: StockAlert[];
}
