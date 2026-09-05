/**
 * OpenAI-compatible {@link AIProviderInterface} implementation (FR-AI-01, FR-AI-03).
 *
 * Selected by AIModule when AI_API_KEY is set; otherwise the module binds
 * {@link NoopAIProvider} and this class is never instantiated. This follows the
 * exact same pattern as MailModule's SMTP/Console selection (NFR-12).
 *
 * Configuration is read once at construction from environment variables:
 *   - AI_API_KEY (required): provider API key
 *   - AI_API_BASE_URL (optional): OpenAI-compatible base URL, defaults to OpenAI
 *   - AI_EMBEDDING_MODEL (optional): embedding model, default text-embedding-3-small
 *   - AI_CHAT_MODEL (optional): chat model, default gpt-4o-mini
 *
 * FR-AI-02 disclosure: this implementation transmits tenant data to the configured
 * provider. Callers must ensure this is an explicit, documented decision before
 * enabling. The data sent includes:
 *   - generateEmbedding: product name, category, SKU, and user search queries
 *   - complete/generateInsights: business aggregates (counts, money totals)
 *   - generateSuggestion: user prompts (may contain business context)
 *
 * All network calls include retry logic with exponential backoff and timeouts
 * to handle transient failures gracefully. Failures degrade to no-op behavior
 * (FR-AI-01) and are logged for observability.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type { CreateEmbeddingResponse } from 'openai/resources/embeddings';
import type { ChatCompletion } from 'openai/resources/chat/completions';
import { AIProviderInterface } from './ai-provider.interface';

// Retry configuration for transient failures
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;
const EMBEDDING_TIMEOUT_MS = 30000; // 30 seconds
const COMPLETION_TIMEOUT_MS = 60000; // 60 seconds

// Default model configurations
const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';
const DEFAULT_CHAT_MODEL = 'gpt-4o-mini';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

// Expected embedding dimension for text-embedding-3-small (matches pgvector column)
const EXPECTED_EMBEDDING_DIMENSION = 1536;

/**
 * Error thrown when an AI operation fails after all retries.
 * Captured and handled by callers to trigger graceful degradation.
 */
export class AIProviderError extends Error {
  constructor(
    message: string,
    public readonly retries: number,
    public readonly lastError?: Error,
  ) {
    super(message);
    this.name = 'AIProviderError';
  }
}

/**
 * OpenAI-compatible AI provider implementation.
 *
 * This class wraps the OpenAI SDK and implements the full AIProviderInterface.
 * It handles configuration, retry logic, timeouts, and error conversion.
 */
@Injectable()
export class OpenAICompatibleAIProvider implements AIProviderInterface {
  private readonly logger = new Logger(OpenAICompatibleAIProvider.name);
  private readonly client: OpenAI;
  private readonly embeddingModel: string;
  private readonly chatModel: string;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('AI_API_KEY');
    if (!apiKey) {
      // AIModule only binds this class when AI_API_KEY exists, so reaching
      // this branch means a wiring mistake — fail before any AI call.
      throw new Error(
        'OpenAICompatibleAIProvider selected but AI_API_KEY is not set. ' +
          'Set the AI_API_KEY environment variable or remove it to use the no-op provider.',
      );
    }

    const baseUrl = config.get<string>('AI_API_BASE_URL') ?? DEFAULT_BASE_URL;
    this.embeddingModel =
      config.get<string>('AI_EMBEDDING_MODEL') ?? DEFAULT_EMBEDDING_MODEL;
    this.chatModel = config.get<string>('AI_CHAT_MODEL') ?? DEFAULT_CHAT_MODEL;

    this.client = new OpenAI({
      apiKey,
      baseURL: baseUrl,
      // OpenAI SDK handles timeouts per-request, not globally
    });

    this.logger.log(
      `OpenAI-compatible provider configured: baseUrl=${baseUrl}, ` +
        `embeddingModel=${this.embeddingModel}, chatModel=${this.chatModel}`,
    );
  }

  isConfigured(): boolean {
    return true;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    return this.withRetry(
      async () => {
        const response: CreateEmbeddingResponse =
          await this.client.embeddings.create(
            {
              model: this.embeddingModel,
              input: text,
            },
            {
              timeout: EMBEDDING_TIMEOUT_MS,
            },
          );

        const embedding = response.data[0]?.embedding;
        if (!embedding) {
          throw new Error(
            `No embedding returned from ${this.embeddingModel} for text: ${text.substring(0, 50)}`,
          );
        }

        if (embedding.length !== EXPECTED_EMBEDDING_DIMENSION) {
          this.logger.warn(
            `Embedding dimension mismatch: expected ${EXPECTED_EMBEDDING_DIMENSION}, ` +
              `got ${embedding.length}. This may indicate a model configuration issue.`,
          );
        }

        this.logger.debug(
          `Generated embedding for text (length: ${text.length}, dimension: ${embedding.length})`,
        );

        return embedding;
      },
      'generateEmbedding',
      { textLength: text.length },
    );
  }

  async complete(
    prompt: string,
    context: Record<string, unknown>,
  ): Promise<string> {
    return this.withRetry(
      async () => {
        const contextString = this.serializeContext(context);
        const systemPrompt = this.buildSystemPrompt(prompt, contextString);

        const response: ChatCompletion =
          await this.client.chat.completions.create(
            {
              model: this.chatModel,
              messages: [
                {
                  role: 'system',
                  content: systemPrompt,
                },
              ],
              temperature: 0.7,
              max_tokens: 500,
            },
            {
              timeout: COMPLETION_TIMEOUT_MS,
            },
          );

        const content = response.choices[0]?.message?.content;
        if (!content) {
          throw new Error(
            `No completion returned from ${this.chatModel} for prompt: ${prompt.substring(0, 50)}`,
          );
        }

        this.logger.debug(
          `Generated completion (prompt length: ${prompt.length}, response length: ${content.length})`,
        );

        return content;
      },
      'complete',
      { promptLength: prompt.length, contextKeys: Object.keys(context).length },
    );
  }

  async generateInsights(
    context: Record<string, unknown>,
  ): Promise<Array<{ title: string; body: string }>> {
    // Build a prompt that asks for multiple insights with titles
    const prompt = `
      You are a business advisor analyzing dashboard data.
      Generate 3-5 actionable insights with clear titles based on the following context.
      Each insight should be a short paragraph (2-3 sentences) that a shop owner can act on.
      Return ONLY a JSON array of objects with 'title' and 'body' fields. No preamble, no markdown.
    `;

    return this.withRetry(
      async () => {
        const contextString = this.serializeContext(context);
        const userPrompt = `${prompt}\n\nContext:\n${contextString}`;

        const response: ChatCompletion =
          await this.client.chat.completions.create(
            {
              model: this.chatModel,
              messages: [
                {
                  role: 'system',
                  content:
                    'You are a helpful business advisor. Respond only with valid JSON.',
                },
                {
                  role: 'user',
                  content: userPrompt,
                },
              ],
              temperature: 0.7,
              max_tokens: 1000,
              response_format: { type: 'json_object' },
            },
            {
              timeout: COMPLETION_TIMEOUT_MS,
            },
          );

        const content = response.choices[0]?.message?.content;
        if (!content) {
          throw new Error('No insights returned from completion API');
        }

        // Parse the JSON response
        try {
          // JSON.parse returns `any`; we narrow it before reading.
          const parsed: unknown = JSON.parse(content);
          if (!Array.isArray(parsed)) {
            throw new Error('Expected JSON array for insights');
          }

          return parsed.map((item: unknown) => {
            if (
              typeof item === 'object' &&
              item !== null &&
              'title' in item &&
              'body' in item
            ) {
              return {
                title: String((item as Record<string, unknown>).title),
                body: String((item as Record<string, unknown>).body),
              };
            }
            throw new Error('Invalid insight format');
          });
        } catch (parseError) {
          this.logger.warn(
            `Failed to parse insights JSON, returning empty array: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
          );
          return [];
        }
      },
      'generateInsights',
      { contextKeys: Object.keys(context).length },
    );
  }

  async generateSuggestion(prompt: string): Promise<string> {
    return this.withRetry(
      async () => {
        const response: ChatCompletion =
          await this.client.chat.completions.create(
            {
              model: this.chatModel,
              messages: [
                {
                  role: 'system',
                  content:
                    'You are a helpful business assistant. Provide concise, actionable suggestions.',
                },
                {
                  role: 'user',
                  content: prompt,
                },
              ],
              temperature: 0.7,
              max_tokens: 200,
            },
            {
              timeout: COMPLETION_TIMEOUT_MS,
            },
          );

        const content = response.choices[0]?.message?.content;
        if (!content) {
          throw new Error('No suggestion returned from completion API');
        }

        return content;
      },
      'generateSuggestion',
      { promptLength: prompt.length },
    );
  }

  /**
   * Execute an async operation with retry logic and exponential backoff.
   * Converts errors to AIProviderError for consistent handling by callers.
   */
  private async withRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    metadata: Record<string, unknown> = {},
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const startTime = Date.now();
        const result = await operation();
        const duration = Date.now() - startTime;

        this.logger.debug(
          `AI ${operationName} succeeded (attempt ${attempt}/${MAX_RETRIES}, duration: ${duration}ms, metadata: ${JSON.stringify(metadata)})`,
        );

        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < MAX_RETRIES) {
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
          this.logger.warn(
            `AI ${operationName} failed (attempt ${attempt}/${MAX_RETRIES}), retrying in ${delay}ms: ${lastError.message}`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          this.logger.error(
            `AI ${operationName} failed after ${MAX_RETRIES} attempts: ${lastError.message}`,
          );
        }
      }
    }

    throw new AIProviderError(
      `AI ${operationName} failed after ${MAX_RETRIES} retries: ${lastError?.message ?? 'Unknown error'}`,
      MAX_RETRIES,
      lastError,
    );
  }

  /**
   * Serialize context object to a string for prompt inclusion.
   * Handles nested objects and arrays, with truncation for very long values.
   */
  private serializeContext(context: Record<string, unknown>): string {
    const entries = Object.entries(context).map(([key, value]) => {
      const serialized = this.serializeValue(value);
      return `${key}: ${serialized}`;
    });
    return entries.join('\n');
  }

  /**
   * Recursively serialize a value to a string representation.
   */
  private serializeValue(value: unknown, depth: number = 0): string {
    if (depth > 3) {
      return '[...]';
    }

    if (value === null) {
      return 'null';
    }

    if (value === undefined) {
      return 'undefined';
    }

    if (typeof value === 'string') {
      return value.length > 200 ? `${value.substring(0, 200)}...` : value;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    if (Array.isArray(value)) {
      const items = value.map((item) => this.serializeValue(item, depth + 1));
      return `[${items.join(', ')}]`;
    }

    if (typeof value === 'object' && value !== null) {
      const entries = Object.entries(value as Record<string, unknown>).map(
        ([k, v]) => `${k}: ${this.serializeValue(v, depth + 1)}`,
      );
      return `{${entries.join(', ')}}`;
    }

    // Primitive fallback. String() on a primitive is fine; ESLint flags
    // the previous form because `value` was narrowed to `object | unknown`
    // and `String({})` produces "[object Object]".
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    return JSON.stringify(value);
  }

  /**
   * Build a system prompt from the user prompt and context.
   * This provides consistent framing for completions.
   */
  private buildSystemPrompt(prompt: string, context: string): string {
    return `
      You are a helpful business assistant.
      Answer the following question based on the provided context.
      Be concise and actionable. No preamble, no markdown.

      Question: ${prompt}
      Context: ${context}
    `;
  }
}
