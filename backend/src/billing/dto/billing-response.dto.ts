/**
 * Wire shapes for Section 6.10. Declared as interfaces so the controller's
 * return type is the contract, and a field cannot be added or dropped by
 * accident.
 *
 * Every monetary value is an integer count of minor units — paisa, for the
 * default PKR (DEBT-012, NFR-14; the `Cents` suffixes are Section 5.10's naming,
 * DEBT-023). Dates leave as ISO 8601 strings rather than Date objects so
 * serialisation is explicit rather than left to JSON.stringify.
 */

/** One row of GET /billing/modules. */
export interface ModuleStatus {
  moduleKey: string;
  /** True only if a subscription row exists and `disabledAt` is null. */
  enabled: boolean;
  /** Absent when the module has never been subscribed. */
  enabledAt?: string;
  /** Absent while the module is enabled. */
  disabledAt?: string;
}

/** GET /billing/subscription. */
export interface SubscriptionSummary {
  plan: {
    name: string;
    /** Paisa per month — 499900 is Rs 4,999. */
    priceMonthly: number;
  };
  status: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
}

/** One row of GET /plans. */
export interface PlanSummary {
  id: string;
  name: string;
  /** Paisa per month — 499900 is Rs 4,999. */
  priceMonthly: number;
  /**
   * Informational only. Section 6.10: "it is not the live access-control list" —
   * GET /billing/modules is authoritative for what a tenant can actually reach.
   */
  modules: string[];
}

/** PATCH /billing/modules, for both the preview and the committed call. */
export interface ModuleToggleResult {
  moduleKey: string;
  enabled: boolean;
  /**
   * Always null for now. Section 6.10 specifies a prorated figure here, but no
   * per-module price exists in Section 5's schema and FR-BILL-02 is referenced
   * without being defined anywhere — see DEBT-018. Typed `number | null` so the
   * field can start carrying a real value without a breaking change.
   */
  proratedChargeCents: number | null;
  effectiveDate: string;
  /**
   * Whether the change was written. Not in Section 6.10's example body, which
   * shows only the preview: added so a client can tell a preview from a
   * committed change without parsing `message`. Documented in DEBT-018.
   */
  committed: boolean;
  message: string;
}

/** Envelope for the two list endpoints (Section 6.1 uses `data` for lists). */
export interface ListEnvelope<T> {
  data: T[];
}
