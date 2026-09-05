// ---------------------------------------------------------------------------
// src/lib/validation/money.ts
//
// One definition of "an amount a form may accept", shared by every schema that
// holds money in major units.
//
// It exists because the check is easy to get subtly wrong in each place it is
// needed. `z.number().min(0)` accepts `8.115`, which `parseMoneyToMinor` then
// refuses at submit time — so the form looks valid, the request fails, and the
// message lands nowhere near the field that caused it. Refining with the same
// function the conversion uses keeps the two from ever disagreeing.
// ---------------------------------------------------------------------------

import { parseMoneyToMinor } from "@/lib/format/currency"

/**
 * `true` when the value can be represented exactly in minor units.
 *
 * Rejects over-precision (`8.115`) and negatives, matching the API's 422s. A
 * refund or a credit is its own transaction with its own audit trail, never a
 * negative amount on this one.
 */
export const isMoneyMajor = (value: number): boolean =>
  parseMoneyToMinor(value) !== null

/**
 * The message for a failed `isMoneyMajor`.
 *
 * It names the precision rather than the sign because a negative is almost always
 * blocked by a `.min(0)` first, and "use at most two decimal places" is the case
 * an operator actually hits — a price copied out of a spreadsheet.
 */
export const MONEY_PRECISION_MESSAGE = "Use at most two decimal places"
