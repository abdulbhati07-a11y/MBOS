/**
 * Access-token claim shape (Section 6.3, "JWT Claim Shape").
 *
 * `roleName` is a plain string so custom roles (DEBT-007) need no change here.
 * Note that authorization decisions read RolePermission from the database —
 * `roleName` is carried for the frontend's convenience, not as a capability.
 */
export interface AccessTokenClaims {
  sub: string;
  tenantId: string;
  roleId: string;
  roleName: string;
}

/**
 * Limited-scope token issued when MFA is required. It grants nothing except the
 * right to call POST /auth/mfa/verify, enforced by the `scope` discriminator.
 */
export interface MfaSessionClaims {
  sub: string;
  scope: 'mfa';
}

export const MFA_SCOPE = 'mfa';
