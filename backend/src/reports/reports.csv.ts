import { csvDate, csvMoney, toCsv } from '../common/csv/csv';
import {
  CustomerActivityRow,
  CustomerActivityTotals,
  InventoryValuationRow,
  SupplierSpendRow,
} from './dto/report.dto';
import { SalesOrderReportRow } from './reports.service';

/**
 * CSV column layouts for the Section 6.11 exports.
 *
 * One function per report, each turning already-computed rows into a CSV
 * document. They live apart from the controller because the column order and
 * headers are a presentation decision that will drift — a column gets added, a
 * label reworded — and keeping them here means that churn never touches routing
 * or the service.
 *
 * Two rules hold across all of them:
 *   - Money cells go through `csvMoney`, which emits a summable number in rupees
 *     (not paisa, not a formula-guarded string) so a negative margin stays a
 *     number the spreadsheet can total. See `csv.ts` for why that matters.
 *   - A boolean renders as `Yes`/`No`, not `true`/`false`: this is a file a person
 *     reads, and `false` in an "Active" column is needless jargon.
 */

const yesNo = (value: boolean): string => (value ? 'Yes' : 'No');

/** A walk-in sale has no customer; the order CSV names it rather than blanking it. */
const WALK_IN_LABEL = '(walk-in)';

export function salesOrdersCsv(rows: readonly SalesOrderReportRow[]): string {
  return toCsv(
    [
      'Order #',
      'Date',
      'Customer',
      'Status',
      'Payment Method',
      'Items',
      'Subtotal',
      'Tax',
      'Total',
    ],
    rows.map((r) => [
      r.orderNumber,
      csvDate(r.date),
      r.customerName ?? WALK_IN_LABEL,
      r.status,
      r.paymentMethod,
      r.lineCount,
      csvMoney(r.subtotalCents),
      csvMoney(r.taxAmountCents),
      csvMoney(r.totalCents),
    ]),
  );
}

export function inventoryValuationCsv(
  rows: readonly InventoryValuationRow[],
): string {
  return toCsv(
    [
      'Product',
      'SKU',
      'Category',
      'UOM',
      'Stock',
      'Reorder Point',
      'Active',
      'Unit Price',
      'Unit Cost',
      'Retail Value',
      'Cost Value',
      'Margin',
    ],
    rows.map((r) => [
      r.name,
      r.sku,
      r.category,
      r.uom,
      r.stock,
      r.reorderPoint,
      yesNo(r.isActive),
      csvMoney(r.priceCents),
      csvMoney(r.costCents),
      csvMoney(r.retailValueCents),
      csvMoney(r.costValueCents),
      csvMoney(r.marginCents),
    ]),
  );
}

/**
 * Customer activity, with one addition the JSON does not need: a final
 * `(walk-in / no customer)` row carrying the walk-in totals.
 *
 * In JSON the walk-in figure lives in `totals.walkIn`, separate from the rows. A
 * CSV has no `totals` block — it is just rows — so without this line the file
 * would sum to *less* than the sales summary by exactly the walk-in take, which is
 * the silent-disagreement failure this whole section is built to avoid. Appending
 * the row makes the spend column reconcile on its own. Its refund cell is left
 * blank because `WalkInActivity` reports only a net figure, and inventing a zero
 * there would misstate it.
 */
export function customerActivityCsv(
  rows: readonly CustomerActivityRow[],
  totals: CustomerActivityTotals,
): string {
  const body = rows.map((r) => [
    r.name,
    r.email,
    yesNo(r.isActive),
    r.orderCount,
    csvMoney(r.totalSpendCents),
    csvMoney(r.refundsCents),
    csvDate(r.lastOrderDate),
  ]);

  if (totals.walkIn.orderCount > 0) {
    body.push([
      '(walk-in / no customer)',
      '',
      '',
      totals.walkIn.orderCount,
      csvMoney(totals.walkIn.totalSpendCents),
      null,
      null,
    ]);
  }

  return toCsv(
    [
      'Customer',
      'Email',
      'Active',
      'Orders',
      'Total Spend',
      'Refunds',
      'Last Order',
    ],
    body,
  );
}

export function supplierSpendCsv(rows: readonly SupplierSpendRow[]): string {
  return toCsv(
    [
      'Supplier',
      'Active',
      'POs',
      'Total',
      'Received',
      'Received Value',
      'Open',
      'Open Value',
      'Cancelled',
      'Cancelled Value',
      'Last Order',
    ],
    rows.map((r) => [
      r.name,
      yesNo(r.isActive),
      r.poCount,
      csvMoney(r.totalCents),
      r.receivedCount,
      csvMoney(r.receivedCents),
      r.openCount,
      csvMoney(r.openCents),
      r.cancelledCount,
      csvMoney(r.cancelledCents),
      csvDate(r.lastOrderDate),
    ]),
  );
}
