import { Injectable } from '@nestjs/common';
import { AIProviderInterface } from './ai-provider.interface';

/**
 * The default {@link AIProviderInterface} binding — the FR-AI-01 no-op.
 *
 * Nothing here reaches the network. It exists so the whole application can be
 * built against AIProviderInterface before any provider account exists (the
 * Phase 1 decision), and so a deployment that never sets AI keys still boots,
 * still serves every endpoint, and reports AI features as OFF rather than
 * erroring.
 *
 * `generateEmbedding` throws rather than returning a fabricated vector: a
 * caller that reaches it with the no-op bound has skipped the `isConfigured()`
 * gate, and a zero vector would silently poison the similarity index with
 * plausible-looking nonsense. `complete` mirrors it. Callers that check
 * `isConfigured()` first — the only supported pattern — never see these.
 */
@Injectable()
export class NoopAIProvider implements AIProviderInterface {
  isConfigured(): boolean {
    return false;
  }

  generateEmbedding(_text: string): Promise<number[]> {
    // Promise.reject, not a bare `throw`: the contract is async, so a caller
    // awaiting this must receive a rejection, not a synchronously thrown error
    // that an `await`-based try/catch would miss.
    return Promise.reject(
      new Error(
        'No AI provider is configured. Set AI_API_KEY (and AI_API_BASE_URL for ' +
          'a non-OpenAI-compatible endpoint) to enable AI features — see ' +
          'backend/.env.example. Callers must gate on isConfigured() first.',
      ),
    );
  }

  complete(
    _prompt: string,
    _context: Record<string, unknown>,
  ): Promise<string> {
    return Promise.reject(
      new Error(
        'No AI provider is configured. Set AI_API_KEY (and AI_API_BASE_URL for ' +
          'a non-OpenAI-compatible endpoint) to enable AI features — see ' +
          'backend/.env.example. Callers must gate on isConfigured() first.',
      ),
    );
  }

  generateInsights(
    _context: Record<string, unknown>,
  ): Promise<Array<{ title: string; body: string }>> {
    // Degradation, not error: a caller asking for insights without a provider
    // gets "no insights", which every AI-labeled UI must render identically to
    // an empty answer from a real provider.
    return Promise.resolve([]);
  }

  generateSuggestion(_prompt: string): Promise<string> {
    return Promise.resolve('');
  }
}
