import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { TotpService } from './totp.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { MAIL_PROVIDER, type MailProvider } from '../mail/mail.provider';

/**
 * Unit coverage of the forgot/reset flow (DEBT-015). The Prisma client is
 * mocked — the e2e suites exercise the real transaction paths against a live
 * database; these tests pin the *behaviours* that must not regress:
 *
 *   - an unknown email answers identically and sends nothing;
 *   - only the digest of a reset token is persisted;
 *   - an expired or already-used token is refused;
 *   - a successful reset revokes every live refresh token.
 */

describe('AuthService — password reset', () => {
  let service: AuthService;
  let prisma: {
    user: { findFirst: jest.Mock; update: jest.Mock };
    passwordResetToken: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    refreshToken: { updateMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let sendPasswordReset: jest.Mock;
  let mail: MailProvider;
  let passwords!: PasswordService;
  const USER = {
    id: 'user-1',
    email: 'owner@dev.local',
    deletedAt: null,
    isActive: true,
  };

  beforeEach(async () => {
    prisma = {
      user: { findFirst: jest.fn(), update: jest.fn() },
      passwordResetToken: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      refreshToken: { updateMany: jest.fn() },
      // The service passes an array of promises; echoing them back is all the
      // real $transaction does for the shape under test.
      $transaction: jest.fn((ops: unknown[]) => Promise.resolve(ops)),
    };
    sendPasswordReset = jest.fn(() => Promise.resolve());
    mail = { sendPasswordReset };
    passwords = new PasswordService();

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: PasswordService, useValue: passwords },
        {
          provide: TokenService,
          useValue: {
            signAccessToken: jest.fn(),
            issueRefreshToken: jest.fn(),
            accessTokenLifetimeSeconds: 900,
          },
        },
        { provide: TotpService, useValue: {} },
        { provide: TenantContextService, useValue: { get: () => null } },
        { provide: ConfigService, useValue: { get: () => undefined } },
        { provide: MAIL_PROVIDER, useValue: mail },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  describe('forgotPassword', () => {
    it('creates a hashed token and mails the raw one for a known user', async () => {
      prisma.user.findFirst.mockResolvedValue(USER);

      await service.forgotPassword(USER.email);

      expect(prisma.passwordResetToken.create).toHaveBeenCalledTimes(1);
      const data = prisma.passwordResetToken.create.mock.calls[0][0].data as {
        userId: string;
        tokenHash: string;
        expiresAt: Date;
      };
      expect(data.userId).toBe(USER.id);
      // 64 hex chars = SHA-256 digest, not a raw base64url token.
      expect(data.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(data.tokenHash).not.toContain('-');
      expect(data.expiresAt.getTime()).toBeGreaterThan(Date.now());

      const sentToken = sendPasswordReset.mock.calls[0][1] as string;
      expect(sentToken).not.toBe(data.tokenHash);
      expect(sentToken.length).toBeGreaterThan(20);
    });

    it('answers silently — no token, no mail — for an unknown email', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.forgotPassword('nobody@dev.local'),
      ).resolves.toBeUndefined();

      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
      expect(sendPasswordReset).not.toHaveBeenCalled();
    });

    it('does not throw when mail delivery fails', async () => {
      prisma.user.findFirst.mockResolvedValue(USER);
      sendPasswordReset.mockRejectedValue(new Error('SMTP down'));

      // The send is fire-and-forget: the promise rejection must not surface.
      await expect(service.forgotPassword(USER.email)).resolves.toBeUndefined();
      // Let the swallowed rejection settle.
      await new Promise((resolve) => setImmediate(resolve));
      expect(sendPasswordReset).toHaveBeenCalled();
    });
  });

  // Three real bcrypt operations (one hash, two verifies) at cost 12 can
  // exceed jest's 5s default on a cold worker.
  describe('resetPassword', () => {
    it('consumes the token, sets the new hash, revokes sessions — atomically', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'prt-1',
        userId: USER.id,
        usedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      });
      prisma.user.update.mockResolvedValue(USER);

      await service.resetPassword('raw-token', 'NewPassw0rd!');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const ops = prisma.$transaction.mock.calls[0][0] as unknown[];
      expect(ops).toHaveLength(3); // consume + password + revoke-all

      // bcrypt salts each hash, so the persisted value cannot be compared to a
      // second hash() output — verify it instead: only the right password opens it.
      const storedHash = prisma.user.update.mock.calls[0][0].data
        .passwordHash as string;
      expect(await passwords.verify('NewPassw0rd!', storedHash)).toBe(true);
      expect(await passwords.verify('OldPassw0rd!', storedHash)).toBe(false);
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: USER.id, revokedAt: null },
        }),
      );
    }, 20_000);

    it('refuses an expired token', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'prt-1',
        userId: USER.id,
        usedAt: null,
        expiresAt: new Date(Date.now() - 60_000),
      });

      await expect(
        service.resetPassword('raw-token', 'NewPassw0rd!'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses an already-used token', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'prt-1',
        userId: USER.id,
        usedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      });

      await expect(
        service.resetPassword('raw-token', 'NewPassw0rd!'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('refuses an unknown token without leaking anything', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(null);

      await expect(
        service.resetPassword('raw-token', 'NewPassw0rd!'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
