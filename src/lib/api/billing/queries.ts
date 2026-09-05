// ---------------------------------------------------------------------------
// src/lib/api/billing/queries.ts
//
// Read side of Section 6.10 — billing.
//
// Gated on the **settings** module, not a billing module of its own: every
// endpoint here needs `settings.read` to view (and `settings.write` to toggle, on
// the mutation side). Under the built-in matrix an Owner and a Manager can both
// read this screen; a Cashier cannot. The frontend `Modules` enum has no
// `billing` member for exactly this reason — billing rides on `settings`.
//
// Two path facts worth remembering:
//   - the plan catalogue is `GET /plans`, NOT `/billing/plans` (@Controller('plans'));
//   - `GET /billing/subscription` 404s when the tenant has never subscribed, which
//     `fetchSubscription` turns into `null` rather than an error — see below.
//
// Every money field is **minor units** (integer paisa): `priceMonthly`,
// `proratedChargeCents`. Render with `formatMoneyMinor`, never `formatMoney`.
// ---------------------------------------------------------------------------

import { api, isApiError } from "../client"

/**
 * One module's on/off state. The server returns only the three industry modules
 * (clinic, pharmacy, restaurant) — core modules are always on and never billed
 * separately (DEBT-016), so they are not in this list.
 */
export interface ModuleStatus {
  moduleKey: string
  enabled: boolean
  /** ISO 8601; present when the module is (or was) enabled. */
  enabledAt?: string
  disabledAt?: string
}

export interface SubscriptionPlan {
  name: string
  /** Minor units (paisa). */
  priceMonthly: number
}

/** `GET /billing/subscription` — the tenant's current plan and period. */
export interface SubscriptionSummary {
  plan: SubscriptionPlan
  /** e.g. "active", "trialing", "past_due" — free-text from the server. */
  status: string
  /** ISO 8601. */
  currentPeriodStart: string
  currentPeriodEnd: string
}

/** One row of `GET /plans` — a plan the tenant could be on. */
export interface PlanSummary {
  id: string
  name: string
  /** Minor units (paisa). */
  priceMonthly: number
  /** Module keys the plan bundles. */
  modules: string[]
}

/**
 * `PATCH /billing/modules` result. The toggle is two-step (see mutations.ts):
 * a request without `confirmed` returns `committed: false` and a `message`
 * describing what would happen; a second request with `confirmed: true` applies
 * it and returns `committed: true`.
 *
 * `proratedChargeCents` is ALWAYS `null` today: no per-module price exists and
 * the proration rule (FR-BILL-02) was never written (DEBT-018). The field is
 * carried so the UI shows a charge the day one is introduced, without a change
 * here.
 */
export interface ModuleToggleResult {
  moduleKey: string
  enabled: boolean
  proratedChargeCents: number | null
  /** ISO 8601. */
  effectiveDate: string
  committed: boolean
  message: string
}

/**
 * All three reads share the `["billing"]` root so one
 * `invalidateQueries({ queryKey: billingKeys.all })` refreshes the screen, while
 * a module toggle can invalidate just `modules()` and `subscription()`.
 */
export const billingKeys = {
  all: ["billing"] as const,
  modules: () => [...billingKeys.all, "modules"] as const,
  subscription: () => [...billingKeys.all, "subscription"] as const,
  plans: () => [...billingKeys.all, "plans"] as const,
}

export async function fetchBillingModules(
  signal?: AbortSignal,
): Promise<ModuleStatus[]> {
  const res = await api.get<{ data: ModuleStatus[] }>("/billing/modules", {
    signal,
  })
  return res.data
}

/**
 * `null` — not an error — when the tenant has no subscription. The server 404s
 * in that case (`billing.service.ts`: "No subscription exists for this tenant."),
 * which is a real state a fresh tenant is in, not a failure the UI should show a
 * red banner for. Every other error propagates for the query to handle.
 */
export async function fetchSubscription(
  signal?: AbortSignal,
): Promise<SubscriptionSummary | null> {
  try {
    return await api.get<SubscriptionSummary>("/billing/subscription", { signal })
  } catch (err) {
    if (isApiError(err) && err.status === 404) return null
    throw err
  }
}

export async function fetchPlans(signal?: AbortSignal): Promise<PlanSummary[]> {
  const res = await api.get<{ data: PlanSummary[] }>("/plans", { signal })
  return res.data
}
