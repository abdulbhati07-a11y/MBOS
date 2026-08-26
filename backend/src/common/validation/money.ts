import { applyDecorators } from '@nestjs/common';
import { IsInt, Max, Min } from 'class-validator';

/**
 * Money on the wire is an integer count of **minor units** — never a float.
 *
 * The tenant's currency is `TenantSettings.currencyCode` (ISO 4217), which
 * defaults to `PKR`. PKR's minor unit is the paisa, 1/100 of a rupee, so
 * `Rs 2,999` is sent and stored as `299900`.
 *
 * A note on why paisa are stored at all, since no Pakistani price is quoted in
 * them — paisa coins left circulation years ago. They are not needed for
 * *pricing*; they are needed for *arithmetic*:
 *
 *   - Tax. GST at 17% on Rs 47 is Rs 7.99. Whole-rupee storage would have to
 *     round that at every line, and those roundings land in order records that
 *     BR-03 then forbids editing.
 *   - Per-unit pricing. A pharmacy strip of ten tablets at Rs 47 is Rs 4.70 a
 *     tablet — a figure the pharmacy module has to be able to represent.
 *
 * So the rupee is the unit a human types and the paisa is the unit the database
 * keeps, which is exactly the split this decorator polices.
 *
 * NAMING. The columns are `priceCents`, `costCents`, `subtotalCents` and so on:
 * "cents" is a USD-ism inherited from the Section 5.10 naming convention, and it
 * predates the currency decision. They hold minor units of whichever currency
 * the tenant is configured for — paisa for a PKR tenant. See DEBT-023.
 *
 * Section 5.4 stores every one of those columns as `Int` (DEBT-012 replaced the
 * original float `price`/`cost`). The frontend's mock data and Zod schemas still
 * speak major units — `products.ts` has `price: 2999` meaning rupees — so a
 * conversion has to happen somewhere. This boundary's job is to make a *missed*
 * conversion loud:
 *
 *   - `29.99` sent to `priceCents` is a 422, not a silently truncated `29`. A
 *     fractional value arriving here means a caller skipped its conversion, and
 *     the only outcome worse than an error is a wrong number written to a
 *     financial column that BR-03 then forbids editing.
 *   - Over-precision is rejected, not rounded, for the same reason. A third
 *     decimal place in a currency amount is not a value to be helpfully
 *     rounded — it is a caller bug, and rounding it hides the bug inside a
 *     record that cannot afterwards be corrected.
 *
 * Whoever converts a decimal must do it on the digit string, never with
 * `Math.round(value * 100)`. Binary floating point makes that off-by-one for
 * real prices: `8.115 * 100` is `811.4999999999999`, which rounds to 811 — a
 * paisa short, permanently. `String(8.115)` is exactly `"8.115"`, because JS
 * number→string emits the shortest round-tripping form, so the digits are
 * recoverable but only via text.
 *
 * Integer minor units on the wire are also what keep a *client's* arithmetic
 * exact: `299900 * 3` is `899700`, while `2999.00 * 3` in a currency that had
 * been through a float would not be trustworthy. Returning floats would
 * reintroduce in the browser precisely the error the schema change removed from
 * the database.
 */

/**
 * Postgres `Int` is int4, so this is the largest storable amount:
 * 2,147,483,647 paisa is Rs 21,474,836.47.
 *
 * Capping here is not a validation nicety: without it the value reaches the
 * driver and returns "value out of range for type integer", turning a plainly
 * bad request into a 500. With it, the caller gets a 422 that names the limit.
 *
 * Worth knowing where this bites. It is ample for a line item or an SMB order,
 * but a large wholesale purchase order in rupees can approach it in a way the
 * same business in dollars never would — a currency with a ~280:1 rate against
 * USD spends two of int4's digits on the exchange rate alone. If a PO total ever
 * needs to exceed Rs 21.4M, the column has to widen to BigInt; the cap is here
 * so that shows up as a 422 naming the limit rather than a driver error.
 */
export const MAX_MONEY_MINOR = 2_147_483_647;

/**
 * `$property` is interpolated by class-validator, so one message serves every
 * money field without naming them individually.
 */
export const MONEY_MESSAGE =
  '$property must be a whole number of paisa — send 299900 for Rs 2,999. ' +
  'Fractional values are rejected rather than rounded, because a rounded ' +
  'figure cannot be corrected once BR-03 locks the record it lands in.';

/**
 * A non-negative money amount in minor units (paisa for a PKR tenant).
 *
 * Shared rather than inlined per DTO so that Sections 6.7 and 6.9 (order totals,
 * PO line costs) enforce the identical rule, and so "minor units, not floats" is
 * stated once instead of once per financial column — the kind of rule that
 * otherwise holds in three places and quietly fails in the fourth.
 */
export function IsMoneyMinor(): PropertyDecorator {
  return applyDecorators(
    IsInt({ message: MONEY_MESSAGE }),
    // Negative money is a credit, and a credit is a separate transaction with
    // its own audit trail (BR-03), never a negative price on a product row.
    Min(0, { message: '$property cannot be negative.' }),
    Max(MAX_MONEY_MINOR, {
      message: `$property exceeds the largest storable amount, ${MAX_MONEY_MINOR} paisa (Rs 21,474,836.47).`,
    }),
  );
}
