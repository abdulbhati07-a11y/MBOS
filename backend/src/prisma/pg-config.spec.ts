import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPgConfig } from './pg-config';

/**
 * Unit tests for the pg/TLS config shared by the Nest runtime, the seed and
 * the re-embed CLI. Pure — no database is touched. The behaviours pinned here
 * are the ones that were previously asserted only in comments, and each maps
 * to a failure mode observed against the live Supabase project:
 *
 *   - a missing cert must fail loudly, never degrade to an unverified
 *     connection (Supabase refuses plaintext, so a silent skip produced a
 *     confusing `XX000 SSL connection is required` instead of a config error);
 *   - `rejectUnauthorized` must be explicit, so nobody "simplifies" it away;
 *   - an `sslmode` in the URL must be rejected, because pg-connection-string
 *     turns it into an `ssl` object that silently replaces the pinned CA.
 */
describe('buildPgConfig', () => {
  const URL = 'postgresql://user:pw@host:5432/db';

  let dir: string;
  let certPath: string;
  const CERT =
    '-----BEGIN CERTIFICATE-----\nnot-a-real-cert\n-----END CERTIFICATE-----\n';

  /** Builds an EnvReader over a plain object, so no global state is mutated. */
  const env =
    (vars: Record<string, string | undefined>) =>
    (key: string): string | undefined =>
      vars[key];

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'mbos-pg-config-'));
    certPath = join(dir, 'ca.crt');
    writeFileSync(certPath, CERT, 'utf8');
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('requires DATABASE_URL', () => {
    expect(() => buildPgConfig(env({}))).toThrow(/DATABASE_URL is not set/);
  });

  it('omits ssl entirely when no CA path is configured', () => {
    const config = buildPgConfig(env({ DATABASE_URL: URL }));

    expect(config.connectionString).toBe(URL);
    expect(config.ssl).toBeUndefined();
  });

  it.each([undefined, '', '   '])(
    'treats a CA path of %p as unset',
    (caPath) => {
      const config = buildPgConfig(
        env({ DATABASE_URL: URL, DATABASE_CA_CERT_PATH: caPath }),
      );

      expect(config.ssl).toBeUndefined();
    },
  );

  it('pins the cert contents and verifies the chain when a CA path is set', () => {
    const config = buildPgConfig(
      env({ DATABASE_URL: URL, DATABASE_CA_CERT_PATH: certPath }),
    );

    expect(config.ssl).toEqual({ ca: CERT, rejectUnauthorized: true });
  });

  it('tolerates surrounding whitespace in the CA path', () => {
    const config = buildPgConfig(
      env({ DATABASE_URL: URL, DATABASE_CA_CERT_PATH: `  ${certPath}  ` }),
    );

    expect(config.ssl).toEqual({ ca: CERT, rejectUnauthorized: true });
  });

  it('throws an actionable error when the CA path does not resolve', () => {
    const missing = join(dir, 'nope.crt');

    expect(() =>
      buildPgConfig(env({ DATABASE_URL: URL, DATABASE_CA_CERT_PATH: missing })),
    ).toThrow(
      /DATABASE_CA_CERT_PATH is set to .*nope\.crt.* could not be read/s,
    );
  });

  it.each([
    'postgresql://user:pw@host:5432/db?sslmode=require',
    'postgresql://user:pw@host:5432/db?sslmode=verify-full',
    'postgresql://user:pw@host:5432/db?schema=public&sslmode=require',
    'postgresql://user:pw@host:5432/db?SSLMODE=REQUIRE',
  ])('rejects a URL carrying sslmode: %s', (url) => {
    expect(() =>
      buildPgConfig(
        env({ DATABASE_URL: url, DATABASE_CA_CERT_PATH: certPath }),
      ),
    ).toThrow(/contains an `sslmode` parameter/);
  });

  it('does not mistake other parameters for sslmode', () => {
    const url = `${URL}?pgbouncer=true&connection_limit=1`;

    expect(() => buildPgConfig(env({ DATABASE_URL: url }))).not.toThrow();
  });
});
