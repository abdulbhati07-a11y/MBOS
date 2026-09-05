// ---------------------------------------------------------------------------
// src/lib/api/settings/mutations.ts
//
// Write side of Section 6.4. Requires `settings.write` — Owner only among the
// built-in roles.
// ---------------------------------------------------------------------------

import { api } from "../client"
import type { TenantSettings } from "./queries"

/**
 * `PATCH /settings`. Partial: an omitted key is left alone.
 *
 * `currencyCode` is on this type because the API accepts it, but changing it on a
 * tenant that already has orders is close to unrecoverable and the UI should
 * treat it as a setup-time choice. Nothing converts: every money column holds
 * minor units of whatever this field says, so switching PKR → USD reinterprets
 * 299900 paisa as $2,999.00. The digits stay and the meaning moves, and Section
 * 6.4 defines no conversion endpoint to undo it with.
 */
export interface UpdateSettingsInput {
  /** 1–200 characters. */
  companyName?: string
  /** Basis points, **integer**. `8.5` is a 422 — send 850. */
  defaultTaxRateBps?: number
  currencyCode?: string
  timezone?: string
}

export function updateSettings(
  input: UpdateSettingsInput,
): Promise<TenantSettings> {
  return api.patch<TenantSettings>("/settings", input)
}
