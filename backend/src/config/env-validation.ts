/**
 * Boot-time environment validation (run from main.ts, before NestFactory).
 *
 * ConfigService already fails lazily — a missing secret surfaces when the first
 * consumer reads it (TokenService's requireSecret), and some gaps never surface
 * at all (a leftover example secret works fine in dev and silently ships to
 * prod). This check moves the failure to boot: a container that cannot serve
 * safely refuses to start, which a health check plus orchestrator restart then
 * makes loud instead of silently insecure.
 *
 * Kept as a plain function rather than a ConfigModule validation schema so it
 * can also enforce cross-variable rules (secrets that equal the documented
 * example values, production CORS constraints) that Joi schemas express
 * awkwardly.
 */

/** Documented example values that must never reach production. */
const KNOWN_PLACEHOLDER_SECRETS = new Set([
  'replace-with-64-byte-random-hex',
  'replace-with-different-64-byte-random-hex',
  'change-me',
  'changeme',
  'secret',
]);

const HEX_64_BYTES = /^[0-9a-f]{128}$/;

function isLocalhostOrigin(origin: string): boolean {
  return (
    /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(
      origin.trim(),
    ) || origin.trim() === 'http://localhost:3000'
  );
}

/**
 * Validates the process environment and throws with a actionable message when
 * the configuration cannot serve safely. Returns nothing — boot simply stops.
 */
export function validateEnv(env: NodeJS.ProcessEnv): void {
  const errors: string[] = [];
  const production = env.NODE_ENV === 'production';
  const allowInsecure = env.ALLOW_INSECURE_ENV === 'true';

  const require = (key: string): void => {
    if (!env[key] || env[key].trim() === '') {
      errors.push(`${key} is required`);
    }
  };

  require('DATABASE_URL');
  require('JWT_ACCESS_SECRET');
  require('JWT_REFRESH_SECRET');

  // Placeholder secrets are always wrong — dev included — because the point of
  // the .env.example values is that they are never used verbatim.
  for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
    const value = env[key];
    if (value && KNOWN_PLACEHOLDER_SECRETS.has(value.trim().toLowerCase())) {
      errors.push(
        `${key} is still the documented example value. Generate a real one with ` +
          `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`,
      );
    }
  }

  if (production && !allowInsecure) {
    // A weak secret in production is the one mistake this file exists to catch.
    for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
      const value = env[key];
      if (!value) continue; // already reported by require()
      if (!HEX_64_BYTES.test(value.trim())) {
        errors.push(
          `${key} must be 128 hex characters (64 random bytes) in production`,
        );
      }
    }

    const origins = (env.CORS_ORIGIN ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0);
    if (origins.length === 0) {
      errors.push(
        'CORS_ORIGIN is required in production (the localhost default is not safe)',
      );
    } else if (origins.every(isLocalhostOrigin)) {
      errors.push(
        'CORS_ORIGIN must not point only at localhost in production — set it to ' +
          'the deployed frontend origin(s), comma-separated',
      );
    }

    // Cookies flip to `secure` in production (auth.controller.ts), which means
    // the API must be reached over HTTPS or no browser will hold the refresh
    // cookie at all. Staging behind plain HTTP sets ALLOW_INSECURE_ENV=true.
    if (env.SMTP_HOST && !env.SMTP_FROM) {
      errors.push('SMTP_FROM is required when SMTP_HOST is set');
    }
  }

  if (errors.length > 0) {
    throw new Error(
      'Invalid environment configuration — refusing to start:\n  - ' +
        errors.join('\n  - '),
    );
  }
}
