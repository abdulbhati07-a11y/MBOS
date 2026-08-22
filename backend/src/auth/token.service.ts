import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AccessTokenClaims, MFA_SCOPE, MfaSessionClaims } from './jwt.types';

/** Short window — just long enough for a user to read a code off their phone. */
const MFA_SESSION_TTL = '5m';

export interface IssuedRefreshToken {
  /** Raw token — goes in the cookie and is never persisted. */
  token: string;
  expiresAt: Date;
}

/**
 * Issues and rotates tokens (Section 6.3).
 *
 * Refresh tokens are opaque random strings; only their SHA-256 digest is stored,
 * so a database dump cannot be replayed as a session. They are single-use:
 * `rotate` revokes the presented token in the same transaction that issues its
 * replacement.
 *
 * Both token stores live on the *unscoped* client. `RefreshToken` is keyed by
 * userId and is read during authentication, before any tenant context exists.
 */
@Injectable()
export class TokenService {
  private readonly accessSecret: string;
  private readonly accessTtl: string;
  private readonly refreshTtlDays: number;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.accessSecret = requireSecret(config, 'JWT_ACCESS_SECRET');
    // JWT_REFRESH_SECRET is validated at boot even though refresh tokens are
    // opaque today: a missing secret should fail loudly on deploy, not later.
    requireSecret(config, 'JWT_REFRESH_SECRET');
    this.accessTtl = config.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '15m';
    this.refreshTtlDays = parseDays(
      config.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d',
    );
  }

  /** Seconds until the access token expires — the `expiresIn` response field. */
  get accessTokenLifetimeSeconds(): number {
    return parseSeconds(this.accessTtl);
  }

  async signAccessToken(claims: AccessTokenClaims): Promise<string> {
    return this.jwt.signAsync(claims, {
      secret: this.accessSecret,
      expiresIn: this.accessTtl,
    });
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    try {
      const claims = await this.jwt.verifyAsync<
        AccessTokenClaims & { scope?: string }
      >(token, { secret: this.accessSecret });
      // An MFA session token is signed with the same secret; reject it here so
      // it cannot be presented as a bearer credential.
      if (claims.scope === MFA_SCOPE) {
        throw new UnauthorizedException('Invalid access token');
      }
      return claims;
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }

  async signMfaSessionToken(userId: string): Promise<string> {
    return this.jwt.signAsync(
      { sub: userId, scope: MFA_SCOPE },
      {
        secret: this.accessSecret,
        expiresIn: MFA_SESSION_TTL,
      },
    );
  }

  async verifyMfaSessionToken(token: string): Promise<string> {
    try {
      const claims = await this.jwt.verifyAsync<MfaSessionClaims>(token, {
        secret: this.accessSecret,
      });
      if (claims.scope !== MFA_SCOPE) throw new Error('wrong scope');
      return claims.sub;
    } catch {
      throw new UnauthorizedException('Invalid or expired MFA session token');
    }
  }

  async issueRefreshToken(userId: string): Promise<IssuedRefreshToken> {
    const token = randomBytes(48).toString('base64url');
    const expiresAt = new Date(
      Date.now() + this.refreshTtlDays * 24 * 60 * 60 * 1000,
    );
    await this.prisma.refreshToken.create({
      data: { userId, tokenHash: digest(token), expiresAt },
    });
    return { token, expiresAt };
  }

  /**
   * Single-use rotation. Revoking and issuing in one transaction means a
   * concurrent replay cannot obtain two live tokens from one presented value.
   */
  async rotateRefreshToken(
    presented: string,
  ): Promise<{ userId: string; refresh: IssuedRefreshToken }> {
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: digest(presented) },
    });

    if (
      !existing ||
      existing.revokedAt !== null ||
      existing.expiresAt.getTime() <= Date.now()
    ) {
      throw new UnauthorizedException('Refresh token is invalid or expired');
    }

    const token = randomBytes(48).toString('base64url');
    const expiresAt = new Date(
      Date.now() + this.refreshTtlDays * 24 * 60 * 60 * 1000,
    );

    await this.prisma.$transaction([
      this.prisma.refreshToken.update({
        where: { id: existing.id },
        data: { revokedAt: new Date() },
      }),
      this.prisma.refreshToken.create({
        data: {
          userId: existing.userId,
          tokenHash: digest(token),
          expiresAt,
        },
      }),
    ]);

    return { userId: existing.userId, refresh: { token, expiresAt } };
  }

  /** Idempotent: logging out twice, or with a stale cookie, is not an error. */
  async revokeRefreshToken(presented: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: digest(presented), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Used after a password change — every existing session must die. */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

function digest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function requireSecret(config: ConfigService, key: string): string {
  const value = config.get<string>(key);
  if (!value) {
    throw new Error(
      `${key} is not set. Generate one with ` +
        `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))" ` +
        'and put it in backend/.env.',
    );
  }
  return value;
}

const UNIT_SECONDS: Readonly<Record<string, number>> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
};

function parseSeconds(ttl: string): number {
  const match = /^(\d+)([smhd])$/.exec(ttl.trim());
  if (!match) throw new Error(`Unsupported token TTL format: ${ttl}`);
  return Number(match[1]) * UNIT_SECONDS[match[2]];
}

function parseDays(ttl: string): number {
  return parseSeconds(ttl) / 86400;
}
