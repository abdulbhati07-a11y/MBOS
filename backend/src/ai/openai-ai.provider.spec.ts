/**
 * Unit tests for OpenAICompatibleAIProvider (FR-AI-01, FR-AI-03).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  OpenAICompatibleAIProvider,
  AIProviderError,
} from './openai-ai.provider';

// Mock OpenAI client
const mockCreateEmbedding = jest.fn();
const mockCreateChatCompletion = jest.fn();

jest.mock('openai', () => {
  // The OpenAI SDK's index.d.ts has `export default OpenAI;` and `export declare class OpenAI`
  // so the named and default imports both resolve to the same class. The provider uses
  // `import OpenAI from 'openai'` (default import), so the mock MUST export `default`
  // for ts-jest + esModuleInterop to find it.
  const OpenAI = jest.fn().mockImplementation(() => ({
    embeddings: {
      create: mockCreateEmbedding,
    },
    chat: {
      completions: {
        create: mockCreateChatCompletion,
      },
    },
  }));
  return {
    __esModule: true,
    OpenAI,
    default: OpenAI,
  };
});

describe('OpenAICompatibleAIProvider', () => {
  let provider: OpenAICompatibleAIProvider;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Create a testing module with mocked ConfigService
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OpenAICompatibleAIProvider,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const config: Record<string, string> = {
                AI_API_KEY: 'test-api-key',
                AI_API_BASE_URL: 'https://api.openai.com/v1',
                AI_EMBEDDING_MODEL: 'text-embedding-3-small',
                AI_CHAT_MODEL: 'gpt-4o-mini',
              };
              return config[key];
            }),
          },
        },
      ],
    }).compile();

    config = module.get<ConfigService>(ConfigService);
    provider = module.get<OpenAICompatibleAIProvider>(
      OpenAICompatibleAIProvider,
    );
  });

  describe('isConfigured', () => {
    it('should return true when AI_API_KEY is set', () => {
      expect(provider.isConfigured()).toBe(true);
    });
  });

  describe('generateEmbedding', () => {
    it('should generate embedding for text', async () => {
      const testText = 'wireless mouse';
      const testEmbedding = new Array(1536).fill(0.1);

      mockCreateEmbedding.mockResolvedValue({
        data: [{ embedding: testEmbedding }],
      });

      const result = await provider.generateEmbedding(testText);

      expect(result).toEqual(testEmbedding);
      expect(mockCreateEmbedding).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'text-embedding-3-small',
          input: testText,
        }),
        expect.any(Object),
      );
    });

    it('should throw AIProviderError after max retries', async () => {
      mockCreateEmbedding.mockRejectedValue(new Error('Network error'));

      await expect(provider.generateEmbedding('test')).rejects.toThrow(
        AIProviderError,
      );

      expect(mockCreateEmbedding).toHaveBeenCalledTimes(3); // MAX_RETRIES
    });

    it('should handle dimension mismatch with warning', async () => {
      const shortEmbedding = new Array(100).fill(0.1);

      mockCreateEmbedding.mockResolvedValue({
        data: [{ embedding: shortEmbedding }],
      });

      // Should still return the embedding even if dimension doesn't match
      const result = await provider.generateEmbedding('test');
      expect(result).toEqual(shortEmbedding);
    });

    it('should throw when no embedding returned', async () => {
      mockCreateEmbedding.mockResolvedValue({
        data: [],
      });

      await expect(provider.generateEmbedding('test')).rejects.toThrow(
        'No embedding returned',
      );
    });
  });

  describe('complete', () => {
    it('should generate completion for prompt and context', async () => {
      const testPrompt = 'What is the sales trend?';
      const testContext = { sales: 1000, previous: 800 };
      const testCompletion = 'Sales are trending up by 25%.';

      mockCreateChatCompletion.mockResolvedValue({
        choices: [
          {
            message: {
              content: testCompletion,
            },
          },
        ],
      });

      const result = await provider.complete(testPrompt, testContext);

      expect(result).toBe(testCompletion);
      expect(mockCreateChatCompletion).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4o-mini',
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'system',
            }),
          ]),
          temperature: 0.7,
          max_tokens: 500,
        }),
        expect.any(Object),
      );
    });

    it('should throw when no completion returned', async () => {
      mockCreateChatCompletion.mockResolvedValue({
        choices: [],
      });

      await expect(provider.complete('test', {})).rejects.toThrow(
        'No completion returned',
      );
    });
  });

  describe('generateInsights', () => {
    it('should generate insights array from context', async () => {
      const testContext = { sales: 1000, inventory: 50 };
      const testJson = JSON.stringify([
        { title: 'Sales up', body: 'Sales increased' },
        { title: 'Stock low', body: 'Inventory needs replenishing' },
      ]);

      mockCreateChatCompletion.mockResolvedValue({
        choices: [
          {
            message: {
              content: testJson,
            },
          },
        ],
      });

      const result = await provider.generateInsights(testContext);

      expect(result).toEqual([
        { title: 'Sales up', body: 'Sales increased' },
        { title: 'Stock low', body: 'Inventory needs replenishing' },
      ]);
    });

    it('should return empty array on invalid JSON', async () => {
      mockCreateChatCompletion.mockResolvedValue({
        choices: [
          {
            message: {
              content: 'Not valid JSON',
            },
          },
        ],
      });

      const result = await provider.generateInsights({});
      expect(result).toEqual([]);
    });

    it('should return empty array on non-array JSON', async () => {
      mockCreateChatCompletion.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({ notAnArray: true }),
            },
          },
        ],
      });

      const result = await provider.generateInsights({});
      expect(result).toEqual([]);
    });
  });

  describe('generateSuggestion', () => {
    it('should generate suggestion for prompt', async () => {
      const testPrompt = 'Suggest a product name';
      const testSuggestion = 'Premium Wireless Mouse';

      mockCreateChatCompletion.mockResolvedValue({
        choices: [
          {
            message: {
              content: testSuggestion,
            },
          },
        ],
      });

      const result = await provider.generateSuggestion(testPrompt);
      expect(result).toBe(testSuggestion);
    });
  });

  describe('constructor validation', () => {
    it('should throw when AI_API_KEY is not set', () => {
      expect(() => {
        const config = {
          get: jest.fn((_key: string) => undefined),
        } as unknown as ConfigService;
        new OpenAICompatibleAIProvider(config);
      }).toThrow(
        'OpenAICompatibleAIProvider selected but AI_API_KEY is not set',
      );
    });
  });

  describe('context serialization', () => {
    it('should serialize nested objects correctly', async () => {
      const testContext = {
        sales: { current: 1000, previous: 800 },
        inventory: { low: 5, out: 2 },
        nested: {
          deep: {
            value: 'test',
          },
        },
      };

      mockCreateChatCompletion.mockResolvedValue({
        choices: [
          {
            message: {
              content: 'test response',
            },
          },
        ],
      });

      // Should not throw - serialization should work
      await expect(
        provider.complete('test', testContext),
      ).resolves.toBeDefined();
    });

    it('should truncate long strings', async () => {
      const longString = 'a'.repeat(300);
      const testContext = { longValue: longString };

      mockCreateChatCompletion.mockResolvedValue({
        choices: [
          {
            message: {
              content: 'test response',
            },
          },
        ],
      });

      await expect(
        provider.complete('test', testContext),
      ).resolves.toBeDefined();

      // Verify the context was serialized with truncation
      const callArgs = mockCreateChatCompletion.mock.calls[0];
      const messages = callArgs[0]?.messages as
        Array<{ content: string }> | undefined;
      expect(messages).toBeDefined();
      expect(
        messages!.some((m: { content: string }) => m.content.includes('...')),
      ).toBe(true);
    });
  });
});

describe('AIProviderError', () => {
  it('should create error with message and retries', () => {
    const error = new AIProviderError('Test error', 3, new Error('Original'));
    expect(error.message).toBe('Test error');
    expect(error.retries).toBe(3);
    expect(error.lastError).toBeDefined();
    expect(error.name).toBe('AIProviderError');
  });
});
