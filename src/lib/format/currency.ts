// ---------------------------------------------------------------------------
// src/lib/format/currency.ts
// The single place money becomes text.
//
// The currency is the Pakistani rupee. Before this file every amount in the app
// was written inline as `${x.toFixed(2)}` — around thirty-five of them — which
// is how the UI came to display dollars while the backend stored PKR. One
// formatter means the currency is now a one-line change instead of a sweep.
//
// TWO UNITS, TWO FUNCTIONS. This is the DEBT-012 boundary and the reason the
// functions are not merged:
//
//   - The mock data holds **major** units — `price: 1500` means Rs 1,500 — so
//     everything rendering mock data calls `formatMoney`.
//   - The API holds **minor** units, integer paisa: `priceCents: 150000`. Those
//     callers use `formatMoneyMinor`.
//
// Passing paisa to `formatMoney` renders a figure 100x too large, which is
// glaring, and that is deliberate: the names differ so the mistake shows up on
// screen rather than being absorbed silently. See
// `backend/src/common/validation/money.ts` for the other half of this contract.
// ---------------------------------------------------------------------------

/** ISO 4217. Mirrors `TenantSettings.currencyCode`, whose default is PKR. */
export const CURRENCY_CODE = "PKR"

/**
 * What a Pakistani receipt actually prints. Not stored anywhere — the schema is
 * explicit that the database keeps the ISO code and never the display symbol —
 * so this is presentation only.
 */
export const CURRENCY_SYMBOL = "Rs"

/** Paisa per rupee. */
export const MINOR_UNITS_PER_MAJOR = 100

/**
 * Largest amount the API will accept, because the columns are Postgres `Int`
 * (int4): 2,147,483,647 paisa, or Rs 21,474,836.47. Exported for form
 * validation so a client can refuse an impossible figure before a round trip;
 * the server enforces it regardless.
 */
export const MAX_MONEY_MINOR = 2_147_483_647

/**
 * Grouping and separators are taken from `en-US`, not `en-PK`, on purpose.
 *
 * Two reasons. First, this runs in both the server render and the browser, and
 * an ICU version difference between the two turns a locale-dependent string into
 * a React hydration mismatch — `en-US` grouping is the same everywhere. Second,
 * `style: "currency"` with PKR renders as "Rs", "₨" or "PKR" depending on the
 * ICU build, so the symbol is prefixed by hand from the constant above and the
 * formatters only ever produce digits.
 *
 * This does mean 1,299,900 rather than the 12,99,900 lakh grouping a Pakistani
 * reader might expect. That is a deliberate deferral, not an oversight: it is a
 * UX decision about the whole app, and `en-PK` is the switch when it is made.
 */
const majorDigits = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const wholeDigits = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
})

/** `Rs 1,500.00` / `-Rs 250.00`. */
function withSymbol(digits: string, negative: boolean): string {
  return `${negative ? "-" : ""}${CURRENCY_SYMBOL} ${digits}`
}

/**
 * Formats an amount held in **major** units — rupees, possibly fractional.
 *
 * This is the mock-data path. `formatMoney(1500)` is `"Rs 1,500.00"`.
 *
 * Always two decimal places, even though paisa coins left circulation and every
 * catalogue price here is whole. Trimming them would round a Rs 76.50 GST line
 * to Rs 77 on screen while the stored figure stayed 76.50, and a total that does
 * not match the lines it is made of is worse than a redundant `.00`.
 *
 * A non-finite value renders as `Rs NaN` rather than being swallowed — it means
 * the caller's arithmetic is broken, and that should be visible.
 */
export function formatMoney(major: number): string {
  return withSymbol(majorDigits.format(Math.abs(major)), major < 0)
}

/**
 * Formats an amount held in **minor** units — integer paisa, as the API sends
 * them. `formatMoneyMinor(150000)` is `"Rs 1,500.00"`.
 *
 * The split into whole and fractional parts is integer arithmetic rather than
 * `minor / 100` so no float ever touches an amount that arrived exact. The error
 * from dividing would be far below the second decimal and would round away
 * harmlessly today, but this is the path real order totals will take, and the
 * point of integer minor units is that they are not approximations at any stage.
 */
export function formatMoneyMinor(minor: number): string {
  const abs = Math.abs(Math.trunc(minor))
  const whole = Math.trunc(abs / MINOR_UNITS_PER_MAJOR)
  const fraction = abs % MINOR_UNITS_PER_MAJOR
  const digits = `${wholeDigits.format(whole)}.${String(fraction).padStart(2, "0")}`
  return withSymbol(digits, minor < 0)
}

/**
 * Converts a typed amount in rupees to integer paisa for the API, or `null` if
 * it is not a valid amount.
 *
 * The conversion is done on the **digit string**, never as `Math.round(x * 100)`.
 * That shortcut is wrong for real prices: `8.115 * 100` is `811.4999999999999`
 * in binary floating point, which rounds down to 811 — a paisa short, in a
 * financial record BR-03 then forbids editing. Reading the digits either side of
 * the decimal point cannot drift.
 *
 * Rejected rather than repaired, matching the API's 422s:
 *   - more than two decimal places (`"8.115"`) — over-precision is a caller bug,
 *     and rounding it hides the bug inside an unfixable record
 *   - negatives — a credit is its own transaction with its own audit trail
 *   - anything non-numeric
 *
 * The int4 ceiling is deliberately *not* enforced here: the server's 422 names
 * the limit and the currency, which is a better message than a form field
 * turning red. Use `MAX_MONEY_MINOR` if a schema wants to check it too.
 */
export function parseMoneyToMinor(input: string | number): number | null {
  const text = (typeof input === "number" ? String(input) : input).trim()
  // Tolerates what a user pastes back out of the UI: grouping commas and the
  // symbol this module printed.
  const cleaned = text.replace(/,/g, "").replace(/^Rs\.?\s*/i, "")

  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned)
  if (!match) return null

  const [, whole, fraction = ""] = match
  const minor =
    Number(whole) * MINOR_UNITS_PER_MAJOR + Number(fraction.padEnd(2, "0"))

  // `String(1e21)` is "1e+21", which the pattern already rejects; this catches
  // a whole part long enough to lose integer precision.
  return Number.isSafeInteger(minor) ? minor : null
}
