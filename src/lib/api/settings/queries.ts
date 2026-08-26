// ---------------------------------------------------------------------------
// src/lib/api/settings/queries.ts
//
// Read side of Section 6.4 — tenant settings.
//
// This is the endpoint that closes DEBT-008. `NewOrderForm` currently hardcodes
// `taxRate: 0` because there was nothing to read the tenant's configured rate
// from; there is now, and a zero-rated order should only ever be one the operator
// asked for.
//
// There is no `tenantId` anywhere in this module. The server takes it from the
// validated JWT — Section 6.4 is explicit that it is never accepted from a route,
// a body, or a query — so a settings call is always "my tenant".
// ---------------------------------------------------------------------------

import { api } from "../client"

/**
 * `GET /settings`.
 *
 * `defaultTaxRateBps` is **basis points**, an integer: 800 means 8.00%. It is not
 * a percentage and not a multiplier — Section 6.4 gives the display conversion as
 * `(bps / 100).toFixed(2) + "%"`, and the arithmetic conversion is `bps / 10_000`.
 * Holding it as 0.08 would put binary floating point back into every total the
 * app computes, which is the same reasoning that keeps money in minor units.
 */
export interface TenantSettings {
  companyName: string
  defaultTaxRateBps: number
  /** ISO 4217, three uppercase letters. One currency per tenant (C-01). */
  currencyCode: string
  /** IANA zone name, e.g. `Asia/Karachi`. */
  timezone: string
}

/** Basis points per whole unit. `800 / 10_000 = 0.08`. */
export const BPS_PER_UNIT = 10_000

/** 100.00%. A rate above par is a typo, not a policy — the API refuses it too. */
export const MAX_TAX_RATE_BPS = 10_000

/** Renders a rate for display: `800` → `"8.00%"`. */
export function formatTaxRateBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`
}

/** Renders a rate for an editable input: `800` → `"8.00"`, no percent sign. */
export function taxRateBpsToPercentInput(bps: number): string {
  return (bps / 100).toFixed(2)
}

/**
 * Converts a percentage a user typed into basis points, or `null` if it is not a
 * rate the API will take.
 *
 * Done on the digit string, for the same reason `parseMoneyToMinor` is:
 * `Math.round(8.15 * 100)` looks safe until a rate lands on a value where the
 * binary representation falls just under the halfway point. Reading the digits
 * cannot drift.
 *
 * More than two decimal places is rejected rather than rounded — basis points are
 * already hundredths of a percent, so "8.155%" is asking for precision the
 * format does not have, and silently rounding it stores a rate the user did not
 * choose and then applies it to money.
 */
export function parseTaxRatePercentToBps(input: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(input.trim().replace(/%$/, ""))
  if (!match) return null

  const [, whole, fraction = ""] = match
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, "0"))

  return bps <= MAX_TAX_RATE_BPS ? bps : null
}

/**
 * Reading a Manager needs: `settings.read` is in the Manager grant while
 * `settings.write` is not, so the whole app can read the tax rate it applies even
 * where it cannot change it. A Cashier holds neither and gets 403 — which is why
 * order creation falls back to the server's own default rather than requiring the
 * POS to read this first.
 */
export const settingsKeys = {
  all: ["settings"] as const,
  tenant: () => [...settingsKeys.all, "tenant"] as const,
}

export function fetchSettings(signal?: AbortSignal): Promise<TenantSettings> {
  return api.get<TenantSettings>("/settings", { signal })
}
