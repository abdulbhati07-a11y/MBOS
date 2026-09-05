import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MAIL_PROVIDER } from '../mail/mail.provider';
import type { MailProvider } from '../mail/mail.provider';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { AccessTokenClaims } from './jwt.types';
import { PasswordService } from './password.service';
import { TotpService } from './totp.service';
import { IssuedRefreshToken, TokenService } from './token.service';
import { LoginDto } from './dto/login.dto';
import { MfaVerifyDto } from './dto/mfa-verify.dto';
import { CurrentUserResponse } from './dto/auth-response.dto';

/** What a completed authentication yields, before it is shaped for the wire. */
export interface AuthenticatedSession {
  claims: AccessTokenClaims;
  accessToken: string;
  expiresIn: number;
  refresh: IssuedRefreshToken;
}

export type LoginOutcome =
  | { kind: 'session'; session: AuthenticatedSession }
  | { kind: 'mfaRequired'; mfaSessionToken: string };

/** How long a password-reset token stays valid, when RESET_TOKEN_TTL_HOURS is unset. */
const DEFAULT_RESET_TTL_HOURS = 1;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly totp: TotpService,
    private readonly tenantContext: TenantContextService,
    config: ConfigService,
    @Inject(MAIL_PROVIDER) private readonly mail: MailProvider,
  ) {
    this.resetTtlMs =
      Number(
        config.get<string>('RESET_TOKEN_TTL_HOURS') ?? DEFAULT_RESET_TTL_HOURS,
      ) *
      60 *
      60 *
      1000;
  }

  private readonly resetTtlMs: number;

  /**
   * Section 6.3 POST /auth/login.
   *
   * Tenant resolution is by email alone (DEBT-014, resolved). D-01 holds that
   * one user belongs to exactly one tenant, so an email identifies its tenant
   * without the caller naming it — there is no tenantSlug in the request, and the
   * login form stays a plain email+password.
   *
   * Runs on the unscoped client by design: the tenant is a *result* of
   * authentication, so there is no context to scope by yet.
   */
  async login(dto: LoginDto): Promise<LoginOutcome> {
    const candidates = await this.prisma.user.findMany({
      where: {
        email: dto.email,
        deletedAt: null,
        isActive: true,
      },
      include: { role: true, tenant: true },
    });

    // Under D-01 this is 0 or 1 row. The "exactly one" guard is kept as
    // fail-closed defence: were the (tenantId, email) uniqueness ever breached so
    // one address spanned two tenants, logging in would be refused rather than
    // signing the wrong tenant in. Zero and ambiguous both read as bad
    // credentials — saying "which tenant?" would confirm the address exists.
    if (candidates.length !== 1) {
      await this.passwords.verifyDecoy(dto.password);
      throw new UnauthorizedException('Invalid email or password');
    }

    const user = candidates[0];
    const passwordMatches = await this.passwords.verify(
      dto.password,
      user.passwordHash,
    );
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.tenant.status !== 'Active') {
      throw new ForbiddenException(
        `Tenant is ${user.tenant.status.toLowerCase()}. Contact your administrator.`,
      );
    }

    if (user.mfaEnabled && user.mfaSecret) {
      return {
        kind: 'mfaRequired',
        mfaSessionToken: await this.tokens.signMfaSessionToken(user.id),
      };
    }

    return {
      kind: 'session',
      session: await this.issueSession({
        sub: user.id,
        tenantId: user.tenantId,
        roleId: user.roleId,
        roleName: user.role.name,
      }),
    };
  }

  /** Section 6.3 POST /auth/mfa/verify. */
  async verifyMfa(dto: MfaVerifyDto): Promise<AuthenticatedSession> {
    const userId = await this.tokens.verifyMfaSessionToken(dto.mfaSessionToken);

    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, isActive: true },
      include: { role: true, tenant: true },
    });
    if (!user || !user.mfaEnabled || !user.mfaSecret) {
      throw new UnauthorizedException('MFA is not available for this account');
    }
    if (user.tenant.status !== 'Active') {
      throw new ForbiddenException(
        `Tenant is ${user.tenant.status.toLowerCase()}. Contact your administrator.`,
      );
    }
    if (!this.totp.verify(user.mfaSecret, dto.code)) {
      throw new UnauthorizedException('Invalid verification code');
    }

    return this.issueSession({
      sub: user.id,
      tenantId: user.tenantId,
      roleId: user.roleId,
      roleName: user.role.name,
    });
  }

  /**
   * Section 6.3 POST /auth/refresh. Claims are rebuilt from the database rather
   * than copied from the old token, so a role change takes effect on the next
   * refresh instead of persisting for the life of the session.
   */
  async refresh(presentedToken: string): Promise<AuthenticatedSession> {
    const { userId, refresh } =
      await this.tokens.rotateRefreshToken(presentedToken);

    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, isActive: true },
      include: { role: true, tenant: true },
    });
    if (!user) {
      // The token was valid but the account is gone or disabled. The rotation
      // already burned it, so there is nothing further to revoke.
      throw new UnauthorizedException('Account is no longer active');
    }
    if (user.tenant.status !== 'Active') {
      throw new ForbiddenException(
        `Tenant is ${user.tenant.status.toLowerCase()}. Contact your administrator.`,
      );
    }

    const claims: AccessTokenClaims = {
      sub: user.id,
      tenantId: user.tenantId,
      roleId: user.roleId,
      roleName: user.role.name,
    };
    return {
      claims,
      accessToken: await this.tokens.signAccessToken(claims),
      expiresIn: this.tokens.accessTokenLifetimeSeconds,
      refresh,
    };
  }

  /** Section 6.3 POST /auth/logout. */
  async logout(presentedToken: string | undefined): Promise<void> {
    if (presentedToken) {
      await this.tokens.revokeRefreshToken(presentedToken);
    }
  }

  /**
   * Section 6.3 POST /auth/forgot-password (DEBT-015).
   *
   * Answers identically whether or not the address belongs to an account: the
   * caller learns nothing about which emails are registered. MailProvider's own
   * contract requires the same of delivery — an unknown address must not throw.
   *
   * The raw token exists in exactly one place — the email body — and only its
   * SHA-256 digest is persisted, matching how refresh tokens are handled. Runs
   * on the unscoped client: authentication has not happened, so there is no
   * tenant context to scope by.
   */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { email, deletedAt: null, isActive: true },
    });

    if (!user) {
      return;
    }

    const token = randomBytes(32).toString('base64url');
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: digest(token),
        expiresAt: new Date(Date.now() + this.resetTtlMs),
      },
    });

    // Delivery failures are swallowed by contract (mail.provider.ts): the
    // account is real, so a bounced mail must not become a 500 that leaks that
    // fact. Fire-and-forget keeps the response time off the mail server's.
    void this.mail.sendPasswordReset(user.email, token).catch(() => undefined);
  }

  /**
   * Section 6.3 POST /auth/reset-password (DEBT-015).
   *
   * Single-use consumption: `usedAt` is set in the same transaction as the
   * password change, so a replayed token finds `usedAt` already set and is
   * refused. Every refresh token is revoked afterwards — a stolen session
   * survives a password reset nowhere.
   *
   * The tenant status check is deliberately absent: a locked tenant blocks new
   * sessions (login/refresh), and reset is the recovery path *out* of a bad
   * state, not a way into one.
   */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: digest(token) },
    });

    if (
      !record ||
      record.usedAt !== null ||
      record.expiresAt.getTime() <= Date.now()
    ) {
      throw new UnauthorizedException('Reset token is invalid or expired');
    }

    const passwordHash = await this.passwords.hash(newPassword);

    await this.prisma.$transaction([
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  /**
   * Section 6.3 GET /auth/me (DEBT-006). Reads role from the database on
   * purpose — an admin's role change is visible immediately instead of after
   * the access token expires.
   *
   * Uses the tenant-scoped client: the guard has already bound the request
   * context, so a forged `sub` from another tenant cannot resolve here.
   */
  async currentUser(): Promise<CurrentUserResponse> {
    const context = this.tenantContext.get();
    if (!context) {
      throw new UnauthorizedException('No authenticated session');
    }

    const user = await this.prisma.db.user.findFirst({
      where: { id: context.userId, deletedAt: null },
      include: { role: true },
    });
    if (!user) {
      throw new UnauthorizedException('Account is no longer active');
    }

    const branch = await this.resolveOperatingBranch();

    return {
      id: user.id,
      email: user.email,
      roleName: user.role.name,
      roleId: user.roleId,
      tenantId: user.tenantId,
      mfaEnabled: user.mfaEnabled,
      branchId: branch?.id ?? null,
      branchName: branch?.name ?? null,
    };
  }

  /**
   * The branch a caller's writes belong to.
   *
   * Ordered by `isDefault` first so an explicitly marked default always wins, then
   * by `createdAt` so a tenant whose flag was never set still gets a stable answer
   * rather than whatever Postgres returns first — an unstable answer here would
   * scatter one tenant's orders across branches for no visible reason.
   *
   * Excludes inactive and soft-deleted branches: `isActive: false` is how a branch
   * that still has history is retired, and filing new sales against a retired
   * branch is precisely what that flag exists to prevent.
   */
  private async resolveOperatingBranch(): Promise<{
    id: string;
    name: string;
  } | null> {
    return this.prisma.db.branch.findFirst({
      where: { isActive: true, deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      select: { id: true, name: true },
    });
  }

  private async issueSession(
    claims: AccessTokenClaims,
  ): Promise<AuthenticatedSession> {
    return {
      claims,
      accessToken: await this.tokens.signAccessToken(claims),
      expiresIn: this.tokens.accessTokenLifetimeSeconds,
      refresh: await this.tokens.issueRefreshToken(claims.sub),
    };
  }
}

function digest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
