import { ConfigService } from '@nestjs/config';
import { createAIProvider } from './ai.module';
import { NoopAIProvider } from './noop-ai.provider';
import { OpenAICompatibleAIProvider } from './openai-ai.provider';
import { isTestEnvironment } from '../config/test-environment';

/**
 * Regression test for the provider-binding guard.
 *
 * The bug this pins: eleven e2e suites boot the full AppModule, `backend/.env`
 * carries a real `AI_API_KEY`, and `createAIProvider` used to select
 * OpenAICompatibleAIProvider on the presence of that key alone. A plain
 * `npm test` therefore fired ~75 embedding requests at a live, paid OpenAI
 * account. It surfaced only because the account had run out of credits and
 * answered 429 — with a funded account it would have quietly spent money on
 * every test run, indefinitely.
 *
 * So the invariant is not "tests should unset AI_API_KEY". It is "no test run
 * can bind a network-reaching provider, whatever the environment says".
 *
 * Constructing OpenAICompatibleAIProvider is inert — it builds an SDK client
 * and issues no request — so the last case can assert the real branch is still
 * reachable without touching the network.
 */
describe('createAIProvider', () => {
  const configWith = (vars: Record<string, string>): ConfigService =>
    ({ get: (key: string) => vars[key] }) as unknown as ConfigService;

  const KEY = 'sk-looks-real-enough-to-be-dangerous';

  it('runs under a test runner — the precondition the guard keys off', () => {
    // Jest sets JEST_WORKER_ID in every worker, always, with no configuration.
    // That is what makes the guard hold even if NODE_ENV is forgotten.
    expect(process.env.JEST_WORKER_ID).toBeDefined();
    expect(isTestEnvironment()).toBe(true);
  });

  it('binds the no-op provider under Jest even when AI_API_KEY is set', () => {
    const provider = createAIProvider(configWith({ AI_API_KEY: KEY }));

    expect(provider).toBeInstanceOf(NoopAIProvider);
    expect(provider).not.toBeInstanceOf(OpenAICompatibleAIProvider);
    expect(provider.isConfigured()).toBe(false);
  });

  it.each([
    ['NODE_ENV=test', { NODE_ENV: 'test' }],
    ['JEST_WORKER_ID set', { JEST_WORKER_ID: '3' }],
    ['TEST_MODE=true', { TEST_MODE: 'true' }],
    [
      'test signal alongside production',
      { NODE_ENV: 'production', JEST_WORKER_ID: '1' },
    ],
  ])('binds the no-op provider when %s, key present', (_label, env) => {
    const provider = createAIProvider(configWith({ AI_API_KEY: KEY }), env);

    expect(provider).toBeInstanceOf(NoopAIProvider);
  });

  it('binds the no-op provider outside tests when no key is configured', () => {
    const provider = createAIProvider(configWith({}), {
      NODE_ENV: 'production',
    });

    expect(provider).toBeInstanceOf(NoopAIProvider);
    expect(provider.isConfigured()).toBe(false);
  });

  it('DOES select the real provider outside tests with a key — the guard is the only thing suppressing it', () => {
    const provider = createAIProvider(
      configWith({
        AI_API_KEY: KEY,
        AI_API_BASE_URL: 'https://api.openai.com/v1',
      }),
      { NODE_ENV: 'production' },
    );

    // Without this case the test above could pass for the wrong reason — a
    // broken key-presence branch would look identical to a working guard.
    expect(provider).toBeInstanceOf(OpenAICompatibleAIProvider);
    expect(provider.isConfigured()).toBe(true);
  });

  it('degrades exactly as FR-AI-01 requires when the no-op is bound', async () => {
    const provider = createAIProvider(configWith({ AI_API_KEY: KEY }));

    // `isConfigured() === false` is the gate every caller checks; the throwing
    // methods are unreachable for anyone who honours it.
    expect(provider.isConfigured()).toBe(false);
    await expect(provider.generateEmbedding('anything')).rejects.toThrow(
      /No AI provider is configured/,
    );
    await expect(provider.generateInsights({})).resolves.toEqual([]);
    await expect(provider.generateSuggestion('anything')).resolves.toBe('');
  });
});
