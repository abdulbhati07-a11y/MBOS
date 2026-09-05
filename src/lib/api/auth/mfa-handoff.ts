// ---------------------------------------------------------------------------
// src/lib/api/auth/mfa-handoff.ts
//
// Carries the `mfaSessionToken` from the login form to the MFA page.
//
// `POST /auth/login` can answer with a challenge instead of a session, and the
// token it returns is the only thing that lets `POST /auth/mfa/verify` finish the
// login. That value has to survive a client-side route change from /login to
// /mfa, and nothing more.
//
// A module-scoped variable, not sessionStorage and not a query parameter:
//
//   - a query parameter would write a live credential into the URL, browser
//     history, and any referrer header the page emits;
//   - sessionStorage would persist it across reloads and leave it readable by
//     any injected script, for the same reason the access token is not kept
//     there either.
//
// The trade-off is deliberate: reloading /mfa loses the token and sends the user
// back to /login. That is the correct outcome — a half-finished login should not
// be resumable from a stale tab.
// ---------------------------------------------------------------------------

interface PendingMfa {
  mfaSessionToken: string
  /** Shown on the MFA page so the user can see which account they are finishing. */
  email: string
}

let pending: PendingMfa | null = null

export function setPendingMfa(value: PendingMfa): void {
  pending = value
}

/**
 * Reads without consuming. Non-destructive on purpose: React re-runs effects in
 * development, and a read-once API would hand the token to the first invocation
 * and null to the second, breaking the page only in dev.
 */
export function getPendingMfa(): PendingMfa | null {
  return pending
}

/** Called once the challenge is resolved or abandoned. */
export function clearPendingMfa(): void {
  pending = null
}
