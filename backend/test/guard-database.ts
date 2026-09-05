/**
 * Hard safety net: refuse to run any e2e test against a database that is not a
 * throwaway local one.
 *
 * Wired in as BOTH `globalSetup` (fails the whole run before a single worker
 * spawns) and `setupFiles` (re-checks inside every worker, because a worker
 * inherits its own copy of the environment and could in principle be handed a
 * different one). Belt and braces is deliberate — the cost is microseconds.
 *
 * ## Why this exists
 *
 * The eleven `src/**\/*.e2e.spec.ts` suites boot the full AppModule and talk to
 * whatever `DATABASE_URL` resolves to. For months that was the live Supabase
 * project: `npm test` created and deleted real tenants, users, products and
 * orders in it. Nothing was lost, because every suite cleans up after itself in
 * `afterAll` — but `afterAll` does not run after a Ctrl+C, an OOM, or a throw in
 * `beforeAll`, and the next interrupted run would have left fixtures behind in
 * the production-track database with no recovery path.
 *
 * ## Allow-list, not deny-list
 *
 * Blocking `*.supabase.com` by name would be one hostname away from useless. The
 * check instead permits only hosts that are, by construction, disposable:
 * loopback, and the service names compose/Actions use for a per-run container.
 * Anything else is refused and named in the error.
 *
 * `E2E_ALLOW_DB_HOST` is the single documented escape hatch, and it is
 * deliberately awkward: it takes the exact host, so nobody sets it "just in
 * case" and forgets. It still refuses Supabase hosts outright.
 */

/** Hosts that can only ever be a disposable, per-run database. */
const ALLOWED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
  '0.0.0.0',
  // Container/service names: `db` and `test-db` in compose, `postgres` in the
  // GitHub Actions services block.
  'db',
  'test-db',
  'postgres',
]);

/** Never allowed, even via E2E_ALLOW_DB_HOST. */
const FORBIDDEN_HOST_PATTERN = /supabase/i;

export function assertEphemeralDatabase(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const url = env.DATABASE_URL;

  if (!url || url.trim() === '') {
    throw new Error(
      [
        'E2E ABORTED: DATABASE_URL is not set.',
        '',
        'The e2e suites need a throwaway Postgres with the pgvector extension.',
        'Start one and point DATABASE_URL at it:',
        '',
        '  npm run e2e:db:up      # pgvector/pgvector:pg17 on 127.0.0.1:55432',
        '  npm run test:e2e       # migrates, seeds, runs, tears down',
        '',
        'See backend/README or docs/deployment.md §3.3.',
      ].join('\n'),
    );
  }

  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(
      'E2E ABORTED: DATABASE_URL is not a parseable URL, so its host cannot be ' +
        'checked against the allow-list. Refusing to connect.',
    );
  }

  if (FORBIDDEN_HOST_PATTERN.test(host)) {
    throw new Error(
      [
        `E2E ABORTED: DATABASE_URL points at a Supabase host (${host}).`,
        '',
        'E2E tests create and delete tenants, users, products and orders. They',
        'must never run against the production-track database — an interrupted',
        'run (Ctrl+C, OOM, a throw in beforeAll) skips the afterAll cleanup and',
        'leaves fixtures behind with no recovery path.',
        '',
        'Point DATABASE_URL at the ephemeral container instead:',
        '  npm run test:e2e',
        '',
        'This particular refusal cannot be overridden.',
      ].join('\n'),
    );
  }

  const explicitlyAllowed = (env.E2E_ALLOW_DB_HOST ?? '').trim();
  if (explicitlyAllowed !== '' && explicitlyAllowed === host) {
    return;
  }

  if (!ALLOWED_HOSTS.has(host)) {
    throw new Error(
      [
        `E2E ABORTED: DATABASE_URL host "${host}" is not a recognised throwaway database.`,
        '',
        `Allowed without configuration: ${[...ALLOWED_HOSTS].join(', ')}`,
        '',
        'E2E tests write to and delete from whatever they connect to, so the',
        'default is to refuse anything that might be real. If this host genuinely',
        'is disposable, set E2E_ALLOW_DB_HOST to exactly that host name.',
      ].join('\n'),
    );
  }
}
