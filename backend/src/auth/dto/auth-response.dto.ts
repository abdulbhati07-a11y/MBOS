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
}
