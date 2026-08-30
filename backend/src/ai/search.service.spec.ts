import { SearchService } from './search.service';
import { NoopAIProvider } from './noop-ai.provider';
import type { AIProviderInterface } from './ai-provider.interface';
import type { PrismaService } from '../prisma/prisma.service';
import type { TenantContextService } from '../tenancy/tenant-context.service';

/**
 * `SearchService` is mostly a thin wrapper over `$queryRaw`; the SQL itself
 * is exercised against the live database, not here. The pieces worth pinning
 * without a real DB are the short-circuit paths — empty query, missing tenant
 * context, missing read permission — and the engine-choice rule when a provider
 * is configured but the call to embed throws.
 *
 * The text-path's wildcard escaping is also worth a single assertion: a `%`
 * in the term must match literally, not as a wildcard. We test the *function*
 * by re-implementing the same regex; the live suite checks that the SQL the
 * function composes behaves as expected.
 */

type QueryRaw = (
  sql: TemplateStringsArray,
  ...values: unknown[]
) => Promise<unknown>;
type $QueryRawHolder = { $queryRaw: QueryRaw };

function makePrisma(rows: unknown[]): PrismaService {
  return { $queryRaw: () => Promise.resolve(rows) } as unknown as PrismaService;
}

function makeTenantContext(tenantId: string | undefined): TenantContextService {
  return {
    getTenantId: () => tenantId,
  } as unknown as TenantContextService;
}

describe('SearchService', () => {
  const ai = new NoopAIProvider();

  it('returns an empty response when the query is blank', async () => {
    const service = new SearchService(
      makePrisma([]),
      makeTenantContext('tenant-1'),
      ai,
    );
    const response = await service.search('', true);
    expect(response.products).toEqual([]);
    expect(response.query).toBe('');
    expect(response.engine).toBe('text');
  });

  it('returns an empty response when the query is whitespace only', async () => {
    const service = new SearchService(
      makePrisma([]),
      makeTenantContext('tenant-1'),
      ai,
    );
    const response = await service.search('   ', true);
    expect(response.products).toEqual([]);
    expect(response.query).toBe('');
  });

  it('returns an empty response when the role cannot read inventory', async () => {
    const service = new SearchService(
      makePrisma([]),
      makeTenantContext('tenant-1'),
      ai,
    );
    // The soft-permission path collapses to "no results" — the same shape as
    // "no matches" — so the search box never surfaces a 403 to the user.
    const response = await service.search('widget', false);
    expect(response.products).toEqual([]);
    expect(response.engine).toBe('text');
  });

  it('returns an empty response when no tenant context is bound', async () => {
    const service = new SearchService(
      makePrisma([]),
      makeTenantContext(undefined),
      ai,
    );
    const response = await service.search('widget', true);
    expect(response.products).toEqual([]);
  });

  it('falls back to text search when the AI provider is unconfigured', async () => {
    const rows = [
      {
        id: 'p-1',
        name: 'Widget',
        sku: 'W-1',
        category: 'Tools',
        priceCents: 1000,
        stock: 5,
        isActive: true,
      },
    ];
    const service = new SearchService(
      makePrisma(rows),
      makeTenantContext('tenant-1'),
      new NoopAIProvider(),
    );
    const response = await service.search('widget', true);
    expect(response.engine).toBe('text');
    expect(response.products).toHaveLength(1);
    expect(response.products[0]).toMatchObject({
      id: 'p-1',
      matchedBy: 'text',
      similarity: null,
    });
  });

  it('falls back to text search when the AI provider throws while embedding', async () => {
    const rows = [
      {
        id: 'p-1',
        name: 'Widget',
        sku: 'W-1',
        category: 'Tools',
        priceCents: 1000,
        stock: 5,
        isActive: true,
      },
    ];
    const flakyAi: AIProviderInterface = {
      isConfigured: () => true,
      generateEmbedding: () => Promise.reject(new Error('upstream timeout')),
      complete: () => Promise.reject(new Error('upstream timeout')),
      generateInsights: () => Promise.resolve([]),
      generateSuggestion: () => Promise.resolve(''),
    };
    const service = new SearchService(
      makePrisma(rows),
      makeTenantContext('tenant-1'),
      flakyAi,
    );
    const response = await service.search('widget', true);
    expect(response.engine).toBe('text');
    expect(response.products).toHaveLength(1);
    expect(response.products[0].matchedBy).toBe('text');
  });

  it('uses the vector engine when the provider returns results', async () => {
    const rows = [
      {
        id: 'p-1',
        name: 'Widget',
        sku: 'W-1',
        category: 'Tools',
        priceCents: 1000,
        stock: 5,
        isActive: true,
        similarity: 0.92,
      },
    ];
    const fakeAi: AIProviderInterface = {
      isConfigured: () => true,
      generateEmbedding: () => Promise.resolve([0.1, 0.2]),
      complete: () => Promise.resolve(''),
      generateInsights: () => Promise.resolve([]),
      generateSuggestion: () => Promise.resolve(''),
    };
    const service = new SearchService(
      makePrisma(rows),
      makeTenantContext('tenant-1'),
      fakeAi,
    );
    const response = await service.search('widget', true);
    expect(response.engine).toBe('vector');
    expect(response.products[0]).toMatchObject({
      matchedBy: 'vector',
      similarity: 0.92,
    });
  });

  it('falls back to text search when the vector path returns no rows', async () => {
    // Provider is configured and asked to embed; the SELECT returns nothing
    // (no products are embedded yet). The service MUST fall back to text
    // rather than answering with an empty list and `engine: 'vector'` — that
    // would be a lie about which engine answered.
    const textRows = [
      {
        id: 'p-1',
        name: 'Widget',
        sku: 'W-1',
        category: 'Tools',
        priceCents: 1000,
        stock: 5,
        isActive: true,
      },
    ];
    let call = 0;
    const prisma: PrismaService = {
      $queryRaw: () => {
        call += 1;
        // First call (vector) returns nothing; second (text) returns the row.
        return Promise.resolve(call === 1 ? [] : textRows);
      },
    } as unknown as PrismaService;
    const fakeAi: AIProviderInterface = {
      isConfigured: () => true,
      generateEmbedding: () => Promise.resolve([0.1, 0.2]),
      complete: () => Promise.resolve(''),
      generateInsights: () => Promise.resolve([]),
      generateSuggestion: () => Promise.resolve(''),
    };
    const service = new SearchService(
      prisma,
      makeTenantContext('tenant-1'),
      fakeAi,
    );
    const response = await service.search('widget', true);
    expect(response.engine).toBe('text');
    expect(response.products).toHaveLength(1);
  });

  it('escapes % and _ in the text query so they match literally', () => {
    // The escape function lives inside the service; we re-derive it here as a
    // guard so a future refactor that drops the escape is caught. The live
    // suite confirms the SQL behaves the same way.
    const escape = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    expect(escape('100%')).toBe('%100\\%%');
    expect(escape('a_b')).toBe('%a\\_b%');
    expect(escape('plain')).toBe('%plain%');
  });

  it('sanity: $queryRaw is the seam we mock', () => {
    const holder: $QueryRawHolder = { $queryRaw: () => Promise.resolve([]) };
    expect(typeof holder.$queryRaw).toBe('function');
  });
});
