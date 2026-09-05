/**
 * Cross-platform e2e runner: bring up the throwaway database, prepare it, run
 * the suites, and tear it down — tearing down even when the suites fail.
 *
 * Why a Node script rather than a chained npm script: npm runs scripts through
 * `cmd.exe` on Windows (there is no `script-shell` set in this repo), so the
 * POSIX idiom `a && b; code=$?; c; exit $code` does not work. Every developer on
 * this project is on Windows and CI is on Ubuntu, so the orchestration has to be
 * portable rather than clever.
 *
 * Usage:  npm run test:e2e:local  [-- <extra jest args>]
 *
 * Env:
 *   KEEP_DB=1  leave the container running afterwards (for debugging a failure —
 *              inspect with `psql postgresql://postgres:postgres@127.0.0.1:55432/mbos_test`)
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const composeFile = resolve(backendDir, '..', 'docker-compose.test.yml');

/** The throwaway database. Port 55432 so it cannot collide with a dev Postgres. */
const DATABASE_URL =
  'postgresql://postgres:postgres@127.0.0.1:55432/mbos_test?schema=public';

/**
 * Values the app needs to boot that are not secrets in this context — the
 * database is destroyed at the end of the run and never reachable from outside
 * the loopback interface. Real secrets are never required to run the suites.
 */
const env = {
  ...process.env,
  DATABASE_URL,
  NODE_ENV: 'test',
  SEED_DEV_TENANT: 'true',
  JWT_ACCESS_SECRET: 'e2e-access-secret-throwaway-database-only-000000000000',
  JWT_REFRESH_SECRET: 'e2e-refresh-secret-throwaway-database-only-1111111111',
  // Deliberately present, and deliberately unusable: proves the provider guard
  // in src/config/test-environment.ts binds the no-op regardless of a key.
  AI_API_KEY: 'e2e-sentinel-key-must-never-be-used-by-any-test',
  // A CA path would be wrong for a plaintext local container; make sure an
  // inherited value from backend/.env cannot break the connection.
  DATABASE_CA_CERT_PATH: '',
  PGSSLROOTCERT: '',
};

let step = 0;
function run(label, command, args, opts = {}) {
  step += 1;
  console.log(`\n=== [${step}] ${label} ===`);
  const result = spawnSync(command, args, {
    cwd: backendDir,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...opts,
  });
  if (result.error) {
    console.error(`\n${label} could not start: ${result.error.message}`);
    return 127;
  }
  return result.status ?? 1;
}

function compose(...args) {
  return run(
    `docker compose ${args.join(' ')}`,
    'docker',
    ['compose', '-f', composeFile, ...args],
  );
}

// --- 1. database up ----------------------------------------------------------
// `--wait` blocks on the healthcheck, so migrate never races first-boot init.
if (compose('up', '-d', '--wait') !== 0) {
  console.error(
    '\nCould not start the e2e database.\n' +
      'This step needs Docker. Check that the daemon is running:  docker info\n' +
      'Without Docker the e2e suites cannot run at all — they need the pgvector\n' +
      'extension, which the smart-search migration creates.',
  );
  process.exit(1);
}

// --- 2. schema + seed --------------------------------------------------------
let code = run('prisma migrate deploy', 'npx', [
  'prisma',
  'migrate',
  'deploy',
  '--schema=prisma/schema.prisma',
]);

if (code === 0) {
  code = run('seed', 'npm', ['run', 'db:seed']);
}

// --- 3. the suites ----------------------------------------------------------
if (code === 0) {
  code = run('jest (e2e)', 'node', [
    '--experimental-vm-modules',
    'node_modules/jest/bin/jest.js',
    '--config',
    './test/jest-e2e.json',
    ...process.argv.slice(2),
  ]);
}

// --- 4. teardown, whatever happened above -----------------------------------
if (process.env.KEEP_DB === '1') {
  console.log(
    `\n=== teardown skipped (KEEP_DB=1) — container still up on 127.0.0.1:55432 ===\n` +
      `Stop it with: docker compose -f "${composeFile}" down -v`,
  );
} else {
  // `-v` removes the volume too. The data directory is tmpfs, so this is belt
  // and braces, but it also drops the network and container records.
  compose('down', '-v');
}

process.exit(code);
