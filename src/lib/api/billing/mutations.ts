// ---------------------------------------------------------------------------
// src/lib/api/billing/mutations.ts
//
// Write side of Section 6.10 — the module toggle.
//
// Permission: `PATCH /billing/modules` needs `settings.write`. A Manager holds
// only `settings.read`, so they can view billing but not change it — gate the
// switches on write, not on the read that shows the page.
//
// TWO-STEP by design. The first request omits `confirmed` and the server replies
// with `committed: false` plus a human message describing the change (and, one
// day, a prorated charge — DEBT-018). The UI shows that, and only on the user's
// confirmation sends the same request again with `confirmed: true`, which the
// server commits. Toggling a module that is already in the requested state is a
// no-op the server reports as `committed: true` immediately. Core (non-industry)
// modules cannot be toggled and answer 409.
// ---------------------------------------------------------------------------

import { api } from "../client"
import type { ModuleToggleResult } from "./queries"

export interface UpdateModuleInput {
  /** One of the industry module keys: clinic | pharmacy | restaurant. */
  moduleKey: string
  enabled: boolean
  /** ISO 8601; the server defaults it to "now" when omitted. */
  effectiveDate?: string
  /** Omit (or false) for a preview; `true` to apply the change. */
  confirmed?: boolean
}

export function updateModuleSubscription(
  input: UpdateModuleInput,
): Promise<ModuleToggleResult> {
  return api.patch<ModuleToggleResult>("/billing/modules", input)
}
