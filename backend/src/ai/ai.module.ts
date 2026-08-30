import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AI_PROVIDER } from './ai-provider.interface';
import { HealthInsightsController } from './health-insights.controller';
import { HealthInsightsService } from './health-insights.service';
import { NoopAIProvider } from './noop-ai.provider';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

/**
 * Binds the {@link AI_PROVIDER} token to a concrete implementation (NFR-11).
 *
 * Phase 1's decision: **interface now, provider later**. No API key exists yet
 * (confirmed during the Phase 1 investigation — no AI credentials anywhere in
 * the repo or environment), so the only binding is the no-op. When a provider
 * is chosen, its implementation is added to this file and the factory grows one
 * branch — the same shape as MailModule's SMTP/Console selection, and the
 * vendor SDK import lives nowhere else.
 *
 * Selection is by configuration, resolved in a factory rather than useClass so
 * the choice is visible in one place. Global like MailModule, so feature
 * services inject AI_PROVIDER without importing this module.
 *
 * The intended final shape, recorded now so the swap stays one edit:
 *
 *   AI_API_KEY set → OpenAICompatibleAIProvider (new file, same folder)
 *   otherwise      → NoopAIProvider (features OFF, FR-AI-01)
 *
 * An OpenAI-compatible base URL (AI_API_BASE_URL) keeps the door open for
 * gateways and self-hosted servers without a second implementation.
 */
@Global()
@Module({
  controllers: [HealthInsightsController, SearchController],
  providers: [
    HealthInsightsService,
    SearchService,
    {
      provide: AI_PROVIDER,
      useFactory: (config: ConfigService) => {
        // One branch today. `AI_API_KEY` is the single switch; when a concrete
        // provider lands it is constructed here with `config` and this comment
        // moves into its own file.
        void config;
        return new NoopAIProvider();
      },
      inject: [ConfigService],
    },
  ],
  exports: [AI_PROVIDER],
})
export class AIModule {}
