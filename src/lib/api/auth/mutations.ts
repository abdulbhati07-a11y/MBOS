// ---------------------------------------------------------------------------
// src/lib/api/auth/mutations.ts
//
// Write side of Section 6.3: login, MFA verification, logout.
//
// Each of these either establishes or destroys the session, so each one is also
// responsible for the in-memory access token. Callers should not have to
// remember to call `setAccessToken` — forgetting it would leave the app
// authenticated on the server but anonymous in the browser.
//
// The refresh token is never touched here. It is an httpOnly cookie: the browser
// stores it, sends it, and clears it on the server's instruction. No JavaScript
// in this codebase can read it, which is the point.
// ---------------------------------------------------------------------------

import { api, setAccessToken } from "../client"
import type {
  AccessTokenResponse,
  LoginResponse,
  MfaRequiredResponse,
} from "../types"

export interface LoginCredentials {
  email: string
  password: string
}

export interface MfaVerification {
  mfaSessionToken: string
  /** Exactly six digits — the backend rejects anything else with 422. */
  code: string
}

/**
 * Discriminates the two shapes `POST /auth/login` can return.
 *
 * Branch on this rather than on `"accessToken" in response`: the MFA branch is
 * the one with a marker field, and testing for the *presence* of a token would
 * silently treat a future response variant as a completed login.
 */
export function isMfaRequired(
  response: LoginResponse,
): response is MfaRequiredResponse {
  return "mfaRequired" in response && response.mfaRequired === true
}

/**
 * Exchanges credentials for a session.
 *
 * Two possible outcomes, both success-status: a completed login (access token in
 * the body, refresh token in a Set-Cookie), or an MFA challenge carrying a
 * short-lived session token to hand to `verifyMfa`. When the login completes the
 * access token is stored here; when MFA is pending nothing is stored, because
 * there is no session yet.
 *
 * `anonymous` because the endpoint is @Public and any token we might still hold
 * is by definition the wrong one. `noRetry` because a 401 here means "bad
 * credentials", not "expired token" — refreshing and replaying would be wrong.
 */
export async function login(
  credentials: LoginCredentials,
): Promise<LoginResponse> {
  const response = await api.post<LoginResponse>("/auth/login", credentials, {
    anonymous: true,
    noRetry: true,
  })
  if (!isMfaRequired(response)) setAccessToken(response.accessToken)
  return response
}

/**
 * Completes an MFA-gated login with a TOTP code.
 *
 * Rate-limited server-side (`@StrictRateLimit`), so a 429 is an expected outcome
 * on repeated wrong codes — `ApiError.retryAfter` carries the wait in seconds.
 */
export async function verifyMfa(
  verification: MfaVerification,
): Promise<AccessTokenResponse> {
  const response = await api.post<AccessTokenResponse>(
    "/auth/mfa/verify",
    verification,
    { anonymous: true, noRetry: true },
  )
  setAccessToken(response.accessToken)
  return response
}

/**
 * Ends the session: revokes the refresh token server-side, clears its cookie,
 * and drops the in-memory access token.
 *
 * The local token is cleared even if the request fails. A logout that leaves the
 * browser still holding a usable bearer token is the one failure mode worth
 * ruling out unconditionally — the server-side token expires on its own, but a
 * user who clicked "log out" must not still be logged in.
 */
export async function logout(): Promise<void> {
  try {
    await api.post<void>("/auth/logout", undefined, {
      anonymous: true,
      noRetry: true,
    })
  } finally {
    setAccessToken(null)
  }
}

// ---------------------------------------------------------------------------
// Password reset (Section 6.3, DEBT-015)
//
// Both endpoints are @Public and strictly rate-limited. The server answers
// `forgotPassword` identically whether or not the address belongs to an
// account — a deliberate anti-enumeration property — so the UI must not
// speculate either: there is no "user not found" branch to render.
// ---------------------------------------------------------------------------

export interface ForgotPasswordInput {
  email: string
}

/**
 * Requests a password-reset email.
 *
 * Always 202 on transport success. Resolve-and-show-the-generic-message is the
 * whole contract: treating a 4xx here as "that email doesn't exist" would
 * undo the server-side design.
 */
export async function forgotPassword(
  input: ForgotPasswordInput,
): Promise<void> {
  await api.post<void>("/auth/forgot-password", input, {
    anonymous: true,
    noRetry: true,
  })
}

export interface ResetPasswordInput {
  token: string
  password: string
}

/**
 * Consumes a reset token and sets the new password.
 *
 * 401 means the token is invalid, expired, or already used — the only failure
 * the reset form can act on. A 422 is the shared password policy validator
 * rejecting the new password, which the form's zod schema should have caught
 * first.
 */
export async function resetPassword(input: ResetPasswordInput): Promise<void> {
  await api.post<void>("/auth/reset-password", input, {
    anonymous: true,
    noRetry: true,
  })
}
