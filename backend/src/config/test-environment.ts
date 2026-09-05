/**
 * "Are we running under a test runner?" — the single predicate the AI provider
 * binding and the e2e database guard both key off.
 *
 * Reads `process.env` DIRECTLY and deliberately, never through `ConfigService`.
 * That is the point: a test that overrides ConfigService (several specs mock it)
 * must not be able to talk its way into a real provider binding, and neither
 * should a stray value in `backend/.env`. There is no way to turn this off from
 * inside the application.
 *
 * Three independent signals, any of which is sufficient:
 *
 *   - `JEST_WORKER_ID` — set by Jest in every worker process, always, with no
 *     configuration required. This is the load-bearing one: it holds even when
 *     someone forgets `NODE_ENV=test`, which is the failure mode that let the
 *     e2e suites reach the live OpenAI account in the first place.
 *   - `NODE_ENV === 'test'` — the conventional flag, set by the npm scripts.
 *   - `TEST_MODE === 'true'` — an explicit override for a runner that sets
 *     neither of the above (a debugger, a one-off harness).
 *
 * Being wrong in the safe direction is cheap (AI features report OFF); being
 * wrong in the unsafe direction spends money against a third-party API from a
 * test suite. So the check is deliberately broad.
 */
export function isTestEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    env.JEST_WORKER_ID !== undefined ||
    env.NODE_ENV === 'test' ||
    env.TEST_MODE === 'true'
  );
}
