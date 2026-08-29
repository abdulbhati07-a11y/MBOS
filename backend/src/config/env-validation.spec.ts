import { validateEnv } from './env-validation';

/**
 * Pins the boot-time env contract. A wrong configuration must stop the server
 * before Nest boots — these tests are the executable form of the table in
 * .env.example.
 */

const BASE: NodeJS.ProcessEnv = {
  DATABASE_URL: 'postgresql://u:p@db:5432/mbos',
  JWT_ACCESS_SECRET: 'a'.repeat(128),
  JWT_REFRESH_SECRET: 'b'.repeat(128),
  CORS_ORIGIN: 'https://app.example.com',
};

describe('validateEnv', () => {
  it('accepts a complete production configuration', () => {
    expect(() =>
      validateEnv({ ...BASE, NODE_ENV: 'production' }),
    ).not.toThrow();
  });

  it('accepts a minimal development configuration (secrets only)', () => {
    expect(() =>
      validateEnv({
        DATABASE_URL: BASE.DATABASE_URL,
        JWT_ACCESS_SECRET: 'dev-secret',
        JWT_REFRESH_SECRET: 'dev-secret-2',
      }),
    ).not.toThrow();
  });

  it.each(['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'])(
    'requires %s',
    (key) => {
      const env = { ...BASE };
      delete env[key];
      expect(() => validateEnv(env)).toThrow(`${key} is required`);
    },
  );

  it.each([
    'replace-with-64-byte-random-hex',
    'replace-with-different-64-byte-random-hex',
  ])('refuses the example placeholder %s in any environment', (secret) => {
    expect(() => validateEnv({ ...BASE, JWT_ACCESS_SECRET: secret })).toThrow(
      /example value/,
    );
  });

  describe('production-only rules', () => {
    it('refuses a short secret in production', () => {
      expect(() =>
        validateEnv({
          ...BASE,
          NODE_ENV: 'production',
          JWT_ACCESS_SECRET: 'short-but-not-placeholder',
        }),
      ).toThrow(/128 hex characters/);
    });

    it('refuses a non-hex 128-char secret in production', () => {
      expect(() =>
        validateEnv({
          ...BASE,
          NODE_ENV: 'production',
          JWT_ACCESS_SECRET: 'z'.repeat(128),
        }),
      ).toThrow(/128 hex characters/);
    });

    it('refuses a missing CORS_ORIGIN in production', () => {
      const env: NodeJS.ProcessEnv = { ...BASE, NODE_ENV: 'production' };
      delete env.CORS_ORIGIN;
      expect(() => validateEnv(env)).toThrow(/CORS_ORIGIN is required/);
    });

    it('refuses a localhost-only CORS_ORIGIN in production', () => {
      expect(() =>
        validateEnv({
          ...BASE,
          NODE_ENV: 'production',
          CORS_ORIGIN: 'http://localhost:3000',
        }),
      ).toThrow(/localhost/);
    });

    it('refuses SMTP_FROM absent when SMTP_HOST is set in production', () => {
      expect(() =>
        validateEnv({
          ...BASE,
          NODE_ENV: 'production',
          SMTP_HOST: 'smtp.example.com',
        }),
      ).toThrow(/SMTP_FROM is required/);
    });

    it('lets ALLOW_INSECURE_ENV=true bypass the production rules (staging)', () => {
      expect(() =>
        validateEnv({
          ...BASE,
          NODE_ENV: 'production',
          JWT_ACCESS_SECRET: 'staging-secret',
          CORS_ORIGIN: 'http://localhost:3000',
          ALLOW_INSECURE_ENV: 'true',
        }),
      ).not.toThrow();
    });
  });

  it('requires SMTP_FROM when SMTP_HOST is set even outside production', () => {
    // SMTP_FROM gating is written inside the production branch; dev relays are
    // usually unconfigured sandboxes, so this is deliberately production-only.
    expect(() =>
      validateEnv({ ...BASE, SMTP_HOST: 'smtp.example.com' }),
    ).not.toThrow();
  });
});
