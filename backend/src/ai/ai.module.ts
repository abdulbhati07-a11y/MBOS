import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isTestEnvironment } from '../config/test-environment';
import { AI_PROVIDER } from './ai-provider.interface';
import type { AIProviderInterface } from './ai-provider.interface';
import { AIController } from './ai.controller';
import { HealthInsightsController } from './health-insights.controller';
import { HealthInsightsService } from './health-insights.service';
import { NoopAIProvider } from './noop-ai.provider';
import { OpenAICompatibleAIProvider } from './openai-ai.provider';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

/**
 * Binds the {@link AI_PROVIDER} token to a concrete implementation (NFR-11).
 *
 * Selection is by configuration, resolved in a factory rather than useClass so
 * the choice is visible in one place. Global like MailModule, so feature
 * services inject AI_PROVIDER without importing this module.
 *
 *   under a test runner → NoopAIProvider, unconditionally (see below)
 *   AI_API_KEY set      → OpenAICompatibleAIProvider
 *   otherwise           → NoopAIProvider (features OFF, FR-AI-01)
 *
 * An OpenAI-compatible base URL (AI_API_BASE_URL) keeps the door open for
 * gateways and self-hosted servers without a second implementation.
 *
 * ## Why tests can never reach a real provider
 *
 * The test-runner branch is first and takes no arguments from ConfigService.
 * It exists because the reverse once happened: eleven `*.e2e.spec.ts` suites
 * boot the full AppModule, `backend/.env` carries a real `AI_API_KEY`, and a
 * plain `npm test` therefore fired ~75 embedding requests at a live, paid
 * OpenAI account (all rejected 429 — no credits — which is the only reason it
 * was noticed at all).
 *
 * `isTestEnvironment()` reads `process.env` directly, so this cannot be
 * defeated by a spec that provides its own ConfigService mock, nor by a value
 * in a `.env` file. Unsetting `AI_API_KEY` is not required and must not be
 * relied on — the guard does not depend on anyone remembering anything.
 */
/**
 * Chooses the {@link AI_PROVIDER} implementation. Exported (rather than inlined
 * as a `useFactory` closure) so the selection can be unit-tested without
 * standing up AIModule's whole dependency graph — see ai.module.spec.ts.
 *
 * `env` is injectable for testing only; production always uses `process.env`.
 */
export function createAIProvider(
  config: ConfigService,
  env: NodeJS.ProcessEnv = process.env,
): AIProviderInterface {
  // FIRST, and not negotiable: no test run ever binds a provider that reaches
  // the network. Deliberately keyed off the process environment, not `config`.
  if (isTestEnvironment(env)) {
    return new NoopAIProvider();
  }

  // Select provider based on AI_API_KEY presence, exactly like MailModule
  // selects SMTP vs Console based on SMTP_HOST.
  const apiKey = config.get<string>('AI_API_KEY');
  if (apiKey) {
    return new OpenAICompatibleAIProvider(config);
  }
  return new NoopAIProvider();
}

@Global()
@Module({
  controllers: [AIController, HealthInsightsController, SearchController],
  providers: [
    HealthInsightsService,
    SearchService,
    {
      provide: AI_PROVIDER,
      useFactory: (config: ConfigService) => createAIProvider(config),
      inject: [ConfigService],
    },
  ],
  exports: [AI_PROVIDER],
})
export class AIModule {}
