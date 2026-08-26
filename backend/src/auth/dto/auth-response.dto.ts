/** Successful login / refresh body (Section 6.3). No refresh token here — cookie only. */
export interface AccessTokenResponse {
  accessToken: string;
  expiresIn: number;
}

/** Login body when the user has MFA enrolled. */
export interface MfaRequiredResponse {
  mfaRequired: true;
  mfaSessionToken: string;
}

export type LoginResponse = AccessTokenResponse | MfaRequiredResponse;

/** GET /auth/me — read from the database, never decoded from the JWT (DEBT-006). */
export interface CurrentUserResponse {
  id: string;
  email: string;
  roleName: string;
  roleId: string;
  tenantId: string;
  mfaEnabled: boolean;
  /**
   * The branch this caller operates in — the tenant's default branch.
   *
   * Added beyond Section 6.3's documented payload because the section as written
   * left the POS unable to function. `POST /orders` and
   * `POST /inventory/adjustments` both require a `branchId`, and the only endpoint
   * that lists branches is `GET /branches`, which requires `settings.read` — a
   * permission no Cashier holds. So the one role whose entire job is ringing up
   * sales had no way to discover the branch every sale must be filed against.
   *
   * This is the right home for it rather than a fallback inside `POST /orders`:
   * `/auth/me` already answers "who am I and what may I do", the endpoint is
   * `@NoModuleRequired` so it adds no permission surface, and keeping `branchId`
   * required on the write endpoints means an order can never be silently filed
   * against a branch nobody chose.
   *
   * `null` when the tenant has no usable branch. That is not a client error to
   * swallow — a tenant in that state cannot record a sale, and the UI should say
   * so rather than post an order with a guessed id.
   *
   * When per-user branch assignment arrives (FR-TEN-03), this becomes the user's
   * assigned branch and callers need no change.
   */
  branchId: string | null;
  branchName: string | null;
}
