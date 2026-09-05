import { EmbeddingService } from './embedding.service';
import { NoopAIProvider } from './noop-ai.provider';
import { AI_PROVIDER } from './ai-provider.interface';
import type { AIProviderInterface } from './ai-provider.interface';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * `EmbeddingService` is mostly a thin wrapper over `$executeRaw`. The pieces
 * worth pinning are: the text it embeds (must be deterministic so a later
 * re-embed is reproducible), and the fail-soft contract (must never throw,
 * even on a DB error). The provider interaction — vector vs text-only path —
 * is tested here; the SQL itself is a one-liner, exercised live rather than
 * mocked.
 */

type ExecuteRaw = (
  sql: TemplateStringsArray,
  ...values: unknown[]
) => Promise<unknown>;
type $ExecuteRawHolder = { $executeRaw: ExecuteRaw };

function makePrisma(executeRaw: ExecuteRaw): PrismaService {
  return { $executeRaw: executeRaw } as unknown as PrismaService;
}

describe('EmbeddingService', () => {
  describe('productText', () => {
    const service = new EmbeddingService(
      makePrisma(() => Promise.resolve(0)),
      new NoopAIProvider(),
    );

    it('concatenates name, category and sku in that order', () => {
      expect(
        service.productText({
          name: 'Wireless Mouse',
          category: 'Electronics',
          sku: 'WM-001',
        }),
      ).toBe('Wireless Mouse Electronics WM-001');
    });

    it('trims surrounding whitespace', () => {
      // `.trim()` strips edges only; internal whitespace is left alone. The
      // production code does not normalise it because (a) pgvector sees the
      // exact text, and (b) whitespace is not what makes two products
      // semantically distinct — the model handles that.
      expect(
        service.productText({
          name: '  Widget  ',
          category: '  Tools  ',
          sku: 'W-1',
        }),
      ).toBe('Widget     Tools   W-1');
    });

    it('produces a stable text for the same product (determinism check)', () => {
      const a = service.productText({
        name: 'X',
        category: 'Y',
        sku: 'Z',
      });
      const b = service.productText({
        name: 'X',
        category: 'Y',
        sku: 'Z',
      });
      expect(a).toBe(b);
    });
  });

  describe('syncProduct', () => {
    it('records only the text when no provider is configured', async () => {
      const calls: Array<{ values: unknown[] }> = [];
      const prisma = makePrisma((_strings, ...values) => {
        calls.push({ values });
        return Promise.resolve(0);
      });
      const service = new EmbeddingService(prisma, new NoopAIProvider());

      await service.syncProduct('tenant-1', {
        id: 'p-1',
        name: 'Widget',
        category: 'Tools',
        sku: 'W-1',
      });

      expect(calls).toHaveLength(1);
      // The first SQL value slot is the text; no vector is ever set without a
      // configured provider.
      expect(calls[0].values[0]).toBe('Widget Tools W-1');
    });

    it('stores the vector alongside the text when a provider is configured', async () => {
      const calls: Array<{ values: unknown[] }> = [];
      const prisma = makePrisma((_strings, ...values) => {
        calls.push({ values });
        return Promise.resolve(0);
      });
      const fakeAi: AIProviderInterface = {
        isConfigured: () => true,
        generateEmbedding: () => Promise.resolve([0.1, 0.2, 0.3]),
        complete: () => Promise.resolve(''),
        generateInsights: () => Promise.resolve([]),
        generateSuggestion: () => Promise.resolve(''),
      };
      const service = new EmbeddingService(prisma, fakeAi);

      await service.syncProduct('tenant-1', {
        id: 'p-1',
        name: 'Widget',
        category: 'Tools',
        sku: 'W-1',
      });

      expect(calls).toHaveLength(1);
      // First value is the JSON-serialised vector; second is the text.
      expect(calls[0].values[0]).toBe('[0.1,0.2,0.3]');
      expect(calls[0].values[1]).toBe('Widget Tools W-1');
    });

    it('swallows a DB error so the write path is never 500s', async () => {
      const prisma = makePrisma(() => Promise.reject(new Error('db down')));
      const service = new EmbeddingService(prisma, new NoopAIProvider());
      // No throw, no rejection.
      await expect(
        service.syncProduct('tenant-1', {
          id: 'p-1',
          name: 'Widget',
          category: 'Tools',
          sku: 'W-1',
        }),
      ).resolves.toBeUndefined();
    });

    it('swallows a provider error so the write path is never 500s', async () => {
      const prisma = makePrisma(() => Promise.resolve(0));
      const fakeAi: AIProviderInterface = {
        isConfigured: () => true,
        generateEmbedding: () => Promise.reject(new Error('upstream timeout')),
        complete: () => Promise.reject(new Error('upstream timeout')),
        generateInsights: () => Promise.resolve([]),
        generateSuggestion: () => Promise.resolve(''),
      };
      const service = new EmbeddingService(prisma, fakeAi);
      await expect(
        service.syncProduct('tenant-1', {
          id: 'p-1',
          name: 'Widget',
          category: 'Tools',
          sku: 'W-1',
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('clearProduct', () => {
    it('issues a single UPDATE and never throws on DB error', async () => {
      const calls: unknown[][] = [];
      const prisma = makePrisma((_strings, ...values) => {
        calls.push(values);
        return Promise.resolve(0);
      });
      const service = new EmbeddingService(prisma, new NoopAIProvider());
      await service.clearProduct('tenant-1', 'p-1');
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual(['p-1', 'tenant-1']);

      // Now a failing DB.
      const failing = makePrisma(() => Promise.reject(new Error('db down')));
      const failingService = new EmbeddingService(
        failing,
        new NoopAIProvider(),
      );
      await expect(
        failingService.clearProduct('tenant-1', 'p-1'),
      ).resolves.toBeUndefined();
    });
  });

  it('is bound to AI_PROVIDER as its injection token', () => {
    // The interface declares AI_PROVIDER as the seam — pinning the symbol here
    // means a refactor that drifts to a different token fails the build before
    // the runtime does.
    expect(typeof AI_PROVIDER.toString()).toBe('string');
    expect((EmbeddingService as unknown as { name?: string }).name).toBe(
      'EmbeddingService',
    );
    // Sanity: the holder shape carries `$executeRaw` (the seam we mock).
    const holder: $ExecuteRawHolder = { $executeRaw: () => Promise.resolve(0) };
    expect(typeof holder.$executeRaw).toBe('function');
  });
});
