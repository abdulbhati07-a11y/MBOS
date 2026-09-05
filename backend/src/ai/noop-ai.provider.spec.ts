import { AIProviderInterface } from './ai-provider.interface';
import { NoopAIProvider } from './noop-ai.provider';

/**
 * Unit coverage for the AI abstraction's contract with the rest of the app.
 *
 * There is no vendor SDK to mock — that is the point of NFR-11 — so what is
 * under test is the no-op binding: the default every deployment runs until a
 * provider key exists. FR-AI-01 (degrade cleanly) and the callers'
 * `isConfigured()` gate both live or die by this contract.
 */
describe('NoopAIProvider', () => {
  let provider: AIProviderInterface;

  beforeEach(() => {
    provider = new NoopAIProvider();
  });

  it('reports itself unconfigured', () => {
    expect(provider.isConfigured()).toBe(false);
  });

  it('throws on generateEmbedding rather than fabricating a vector', async () => {
    // A zero or random vector here would silently poison a similarity index.
    // Throwing is the contract that keeps the isConfigured() gate honest.
    await expect(provider.generateEmbedding('wireless mouse')).rejects.toThrow(
      /No AI provider is configured/,
    );
  });

  it('throws on complete rather than returning text', async () => {
    await expect(
      provider.complete('Explain this metric', { sales: 1 }),
    ).rejects.toThrow(/No AI provider is configured/);
  });

  it('degrades insights to empty, not error (FR-AI-01)', async () => {
    await expect(provider.generateInsights({})).resolves.toEqual([]);
  });

  it('degrades suggestion to empty string, not error', async () => {
    await expect(provider.generateSuggestion('prompt')).resolves.toBe('');
  });
});
