import { applyDecorators } from '@nestjs/common';
import { IsInt, Max, Min } from 'class-validator';

/**
 * Money on the wire is an integer count of cents — never a float.
 *
 * Section 5.4 stores `priceCents`, `costCents` and every `*Cents` total as `Int`
 * (DEBT-012 replaced the original float `price`/`cost`). The frontend's mock data
 * and Zod schemas still speak floats — `products.ts` has `price: 29.99` — so a
 * conversion has to happen somewhere. This boundary's job is to make a *missed*
 * conversion loud:
 *
 *   - `29.99` sent to `priceCents` is a 422, not a silently truncated `29`. A
 *     float arriving here means a caller skipped its conversion, and the only
 *     outcome worse than an error is a wrong number written to a financial
 *     column that BR-03 then forbids editing.
 *   - Over-precision is rejected, not rounded, for the same reason. Three
 *     decimal places in a currency amount is not a value to be helpfully
 *     rounded — it is a caller bug, and rounding it hides the bug inside a
 *     record that cannot afterwards be corrected.
 *
 * Whoever converts a decimal must do it on the digit string, never with
 * `Math.round(value * 100)`. Binary floating point makes that off-by-one for
 * real prices: `8.115 * 100` is `811.4999999999999`, which rounds to 811 — a
 * cent short, permanently. `String(8.115)` is exactly `"8.115"`, because JS
 * number→string emits the shortest round-tripping form, so the digits are
 * recoverable but only via text.
 *
 * Integer cents on the wire is also what keeps a *client's* arithmetic exact:
 * `2999 * 3` is `8997`, while `29.99 * 3` is `89.97000000000001`. Returning
 * floats would reintroduce in the browser precisely the error the schema change
 * removed from the database.
 */

/**
 * Postgres `Int` is int4, so this is the largest storable amount (~$21.4M).
 *
 * Capping here is not a validation nicety: without it the value reaches the
 * driver and returns "value out of range for type integer", turning a plainly
 * bad request into a 500. With it, the caller gets a 422 that names the limit.
 */
export const MAX_MONEY_CENTS = 2_147_483_647;

/**
 * `$property` is interpolated by class-validator, so one message serves every
 * money field without naming them individually.
 */
export const CENTS_MESSAGE =
  '$property must be a whole number of cents — send 2999 for 29.99. ' +
  'Fractional values are rejected rather than rounded, because a rounded ' +
  'figure cannot be corrected once BR-03 locks the record it lands in.';

/**
 * A non-negative money amount in cents.
 *
 * Shared rather than inlined per DTO so that Sections 6.7 and 6.9 (order totals,
 * PO line costs) enforce the identical rule, and so "cents, not floats" is
 * stated once instead of once per financial column — the kind of rule that
 * otherwise holds in three places and quietly fails in the fourth.
 */
export function IsCents(): PropertyDecorator {
  return applyDecorators(
    IsInt({ message: CENTS_MESSAGE }),
    // Negative money is a credit, and a credit is a separate transaction with
    // its own audit trail (BR-03), never a negative price on a product row.
    Min(0, { message: '$property cannot be negative.' }),
    Max(MAX_MONEY_CENTS, {
      message: `$property exceeds the largest storable amount, ${MAX_MONEY_CENTS} cents.`,
    }),
  );
}
