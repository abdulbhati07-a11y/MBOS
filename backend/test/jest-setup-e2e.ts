import { assertEphemeralDatabase } from './guard-database';

/**
 * Jest `setupFiles` entry for the e2e config — runs inside every worker before
 * the test framework is installed, so a refusal happens before any spec's
 * `beforeAll` can open a connection.
 *
 * Also runs the AI-provider assertion: `AIModule` binds the no-op provider
 * whenever `isTestEnvironment()` is true, and `JEST_WORKER_ID` guarantees that
 * here — but asserting it makes the invariant visible at the point it matters
 * rather than only in ai.module.ts's comment.
 */
assertEphemeralDatabase();

if (process.env.JEST_WORKER_ID === undefined) {
  throw new Error(
    'E2E ABORTED: JEST_WORKER_ID is unset inside a Jest worker. That is the ' +
      'signal AIModule uses to force the no-op AI provider, so without it a ' +
      'test run could bind a live provider. Refusing to continue.',
  );
}
