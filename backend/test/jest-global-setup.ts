import { assertEphemeralDatabase } from './guard-database';

/**
 * Jest `globalSetup` for the e2e config. Runs once, in the main process, before
 * any worker is spawned — so a misconfigured DATABASE_URL fails the run in under
 * a second instead of eleven suites deep.
 *
 * The same assertion also runs per-worker via `setupFiles`
 * (test/jest-setup-e2e.ts); see guard-database.ts for why both.
 */
export default function globalSetup(): void {
  assertEphemeralDatabase();

  const host = new URL(process.env.DATABASE_URL as string).host;

  console.log(`\n[e2e] database host verified as throwaway: ${host}`);

  console.log('[e2e] AI provider: forced no-op (no external API calls)\n');
}
