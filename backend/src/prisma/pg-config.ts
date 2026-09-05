import { readFileSync } from 'node:fs';

import type { ClientConfig } from 'pg';

/**
 * Reads an environment variable. Lets the same builder serve Nest's
 * ConfigService (`config.get.bind(config)`) and the standalone CLI entry
 * points that only have `process.env`.
 */
export type EnvReader = (key: string) => string | undefined;

/** Reads straight from `process.env`. Default for the CLI entry points. */
export const processEnvReader: EnvReader = (key) => process.env[key];

/**
 * Builds the node-postgres client config that every Prisma connection in this
 * repo uses — the Nest runtime (prisma.service.ts), the seed (seed.ts) and the
 * re-embed CLI (ai/reembed-all.ts). Two knobs:
 *
 *   DATABASE_URL            — required, the connection string.
 *   DATABASE_CA_CERT_PATH   — optional, path to a PEM file pinned as the ONLY
 *                             trust anchor for the connection.
 *
 * ## When the CA cert is required
 *
 * Supabase serves a cert chained to a private root (`Supabase Root 2021 CA`)
 * that is NOT in Node's bundled store, so without pinning the handshake fails
 * with `SELF_SIGNED_CERT_IN_CHAIN`. Stock Postgres and providers fronted by a
 * publicly-trusted chain need no cert — leave the var unset.
 *
 * Note what unset does NOT mean: it is not a fallback that "still works" for
 * Supabase. Supabase rejects an un-encrypted connection outright
 * (`XX000 SSL connection is required`), so against Supabase the var is
 * mandatory, not an optimisation.
 *
 * ## Why `sslmode` must not appear in DATABASE_URL
 *
 * `PrismaPg` hands the connection string to `pg`, which parses it with
 * `pg-connection-string`. Any `?sslmode=...` makes the parser emit its own
 * `ssl` object, and that REPLACES the `ssl` set here — silently dropping the
 * pinned CA and reintroducing `SELF_SIGNED_CERT_IN_CHAIN`. TLS is already
 * mandatory server-side, so the param buys nothing. Verified empirically:
 * `sslmode=require` + a pinned CA fails; no `sslmode` + a pinned CA passes.
 *
 * `rejectUnauthorized` is set explicitly rather than left to node-postgres's
 * default so the security posture is visible in code: the server cert must
 * chain to the pinned CA, and a wrong or stale cert fails the handshake
 * instead of degrading to opportunistic encryption.
 *
 * The file is read synchronously: it happens once at process start, and a
 * missing or unreadable file is a configuration error that should refuse to
 * boot rather than surface later as a confusing TLS error.
 */
export function buildPgConfig(env: EnvReader = processEnvReader): ClientConfig {
  const connectionString = env('DATABASE_URL');
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Copy backend/.env.example to backend/.env ' +
        'and set a PostgreSQL connection string before starting the server.',
    );
  }

  if (/[?&]sslmode=/i.test(connectionString)) {
    throw new Error(
      'DATABASE_URL contains an `sslmode` parameter. Remove it: ' +
        'pg-connection-string turns it into an `ssl` object that overrides ' +
        'the pinned DATABASE_CA_CERT_PATH, which breaks TLS verification ' +
        'against providers using a private CA (e.g. Supabase).',
    );
  }

  const pgConfig: ClientConfig = { connectionString };

  const caPath = env('DATABASE_CA_CERT_PATH');
  if (caPath && caPath.trim() !== '') {
    let ca: string;
    try {
      ca = readFileSync(caPath.trim(), 'utf8');
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(
        `DATABASE_CA_CERT_PATH is set to ${JSON.stringify(caPath)} but the ` +
          `file could not be read: ${reason}. Either point it at the right ` +
          `path, or unset it if this database's cert is signed by a ` +
          `publicly-trusted CA. See docs/supabase-setup.md.`,
      );
    }
    pgConfig.ssl = { ca, rejectUnauthorized: true };
  }

  return pgConfig;
}
