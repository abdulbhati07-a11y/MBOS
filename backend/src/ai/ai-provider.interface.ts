/**
 * AI capability abstraction (Section 4.7, NFR-11).
 *
 * The AI features — Smart Search (FR-AI-01-adjacent), Dashboard Health
 * Insights (FR-AI-03) — must never depend on a vendor SDK. Everything the
 * application needs from a provider is named here, and everything a provider
 * must supply is implemented behind {@link AI_PROVIDER}. Swapping providers is
 * a one-line change in ai.module.ts, exactly as MailProvider's selection is a
 * one-line change in mail.module.ts (NFR-12, the established precedent in this
 * codebase).
 *
 * The method set deliberately unites what Section 4.7 sketches
 * (`generateInsights`, `generateSuggestion`) with what the Phase 1 features
 * call (`generateEmbedding`, `complete`). Section 4.7 says "other capabilities
 * as needed" — the concrete surface is the codebase's to settle, and both
 * halves are kept so the spec's citation stays honest.
 *
 * FR-AI-01 requires the product to degrade cleanly when no provider is
 * configured or reachable: the default binding is therefore a no-op provider
 * (see noop-ai.provider.ts), and callers MUST treat `isConfigured() === false`
 * as "feature off", never as an error.
 *
 * FR-AI-02: what each method sends to the provider is part of the feature's
 * contract and is documented on the method — read before enabling any
 * implementation that transmits tenant data.
 */
export interface AIProviderInterface {
  /**
   * Whether a real provider is configured. `false` means the features built on
   * this interface are OFF — callers must hide or degrade, not throw.
   */
  isConfigured(): boolean;

  /**
   * Embed a short text for vector similarity search.
   *
   * FR-AI-02 disclosure: the argument is tenant data — a product's name, SKU
   * and category, or the user's raw search query. Enabling any transmitting
   * implementation must be an explicit, documented decision.
   *
   * Returns a fixed-length vector whose dimension is fixed per provider; the
   * pgvector column (see the smart-search migration) is sized to match.
   */
  generateEmbedding(text: string): Promise<number[]>;

  /**
   * One-shot text completion.
   *
   * FR-AI-02 disclosure: `context` may contain business aggregates (order
   * counts, stock figures). It must never contain personal data (customer
   * names, emails) — callers build the context, and this interface is the
   * checkpoint where that rule is stated.
   */
  complete(prompt: string, context: Record<string, unknown>): Promise<string>;

  /* Section 4.7's sketched surface, retained for spec fidelity. Phase 1's
   * features express both through the methods above; a richer implementation
   * may specialise these later. */
  generateInsights(
    context: Record<string, unknown>,
  ): Promise<Array<{ title: string; body: string }>>;

  generateSuggestion(prompt: string): Promise<string>;
}

/**
 * Injection token for {@link AIProviderInterface}. A TypeScript interface does
 * not exist at runtime, so it cannot be a Nest provider token on its own —
 * inject with `@Inject(AI_PROVIDER)`.
 */
export const AI_PROVIDER = Symbol('AI_PROVIDER');
