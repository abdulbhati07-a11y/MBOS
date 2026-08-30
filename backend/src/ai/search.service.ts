import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { AI_PROVIDER } from './ai-provider.interface';
import type { AIProviderInterface } from './ai-provider.interface';
import { SearchProductHit, SearchResponse } from './dto/search.dto';

/**
 * Smart Search (Phase 1) — natural-language product lookup.
 *
 * Two engines, one endpoint, and the choice between them is made per request
 * from real capability, never from configuration alone:
 *
 *   - `vector`  — embed the query, cosine-rank every embedded product of this
 *                 tenant. Requires a configured AI provider AND embedded rows;
 *                 either missing falls back.
 *   - `text`    — the ILIKE fallback over name/SKU/category. Same contract as
 *                 `GET /products?search=`, which is what the catalogue already
 *                 answers with.
 *
 * TENANT ISOLATION — the load-bearing comment in this file. The
 * tenant-scoping Prisma extension wraps the typed client (`prisma.db`) but NOT
 * `$queryRaw`, so every raw query here takes the tenantId as an explicit bind
 * parameter, read from the request-scoped AsyncLocalStorage via
 * TenantContextService (the same source the extension itself uses).
 *
 * AUTHORIZATION — search crosses modules, so a flat module gate would leak.
 * The controller passes the caller's `inventory.read` in, and a role without
 * it simply gets an empty products array — the same shape as "no matches".
 * This is a deliberate, documented divergence from a 403: the endpoint is a
 * global search box, and an empty section is the honest result for "you may
 * not see this section".
 */
interface SearchRow {
  id: string;
  name: string;
  sku: string;
  category: string;
  priceCents: number;
  stock: number;
  isActive: boolean;
  similarity?: number;
}

@Injectable()
export class SearchService {
  private static readonly MAX_HITS = 20;
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    @Inject(AI_PROVIDER) private readonly ai: AIProviderInterface,
  ) {}

  async search(
    rawQuery: string | undefined,
    canReadInventory: boolean,
  ): Promise<SearchResponse> {
    const q = (rawQuery ?? '').trim();

    if (!canReadInventory || !q) {
      return { query: q, engine: 'text', products: [] };
    }

    // The same source the tenant-scoping extension reads. Undefined means the
    // route ran outside the middleware chain — structurally impossible behind
    // TenantContextMiddleware, and returning nothing is the safe behaviour
    // regardless.
    const tenantId = this.tenantContext.getTenantId();
    if (!tenantId) {
      return { query: q, engine: 'text', products: [] };
    }

    // Vector path first. Any failure — provider unreachable, no embedded rows,
    // a query that will not embed — degrades to text (FR-AI-01), and the
    // engine reported to the client names the one that actually answered.
    if (this.ai.isConfigured()) {
      try {
        const vector = await this.ai.generateEmbedding(q);
        const rows = await this.vectorSearch(tenantId, vector);
        if (rows.length > 0) {
          return {
            query: q,
            engine: 'vector',
            products: rows.map<SearchProductHit>((r) => ({
              id: r.id,
              name: r.name,
              sku: r.sku,
              category: r.category,
              priceCents: r.priceCents,
              stock: r.stock,
              isActive: r.isActive,
              matchedBy: 'vector',
              similarity: r.similarity ?? 0,
            })),
          };
        }
      } catch (err) {
        this.logger.warn(
          `Vector search failed; falling back to text: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const rows = await this.textSearch(tenantId, q);
    return {
      query: q,
      engine: 'text',
      products: rows.map<SearchProductHit>((r) => ({
        id: r.id,
        name: r.name,
        sku: r.sku,
        category: r.category,
        priceCents: r.priceCents,
        stock: r.stock,
        isActive: r.isActive,
        matchedBy: 'text',
        similarity: null,
      })),
    };
  }

  /* ---------------------------------------------------------------------- */

  private async vectorSearch(
    tenantId: string,
    vector: number[],
  ): Promise<SearchRow[]> {
    // pgvector's text cast: the array is serialised and cast to the column
    // type server-side. Parameterised — the JSON text is data, never SQL.
    const vectorText = JSON.stringify(vector);
    const limit = SearchService.MAX_HITS;

    // 1 - cosine_distance = cosine similarity in [0, 1]. The tenantId bind is
    // the isolation boundary; `deletedAt IS NULL` mirrors every other read;
    // `embedding IS NOT NULL` is what the partial HNSW index serves.
    return this.prisma.$queryRaw<SearchRow[]>`
      SELECT "id", "name", "sku", "category", "priceCents", "stock", "isActive",
             1 - ("embedding" <=> ${vectorText}::vector) AS "similarity"
      FROM "Product"
      WHERE "tenantId" = ${tenantId}
        AND "deletedAt" IS NULL
        AND "embedding" IS NOT NULL
      ORDER BY "embedding" <=> ${vectorText}::vector
      LIMIT ${limit}
    `;
  }

  private async textSearch(tenantId: string, q: string): Promise<SearchRow[]> {
    // ILIKE with escaped wildcards: `%` and `_` in the term must match
    // literally, exactly as Prisma's `contains` does for `?search=` elsewhere.
    const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const limit = SearchService.MAX_HITS;

    return this.prisma.$queryRaw<SearchRow[]>`
      SELECT "id", "name", "sku", "category", "priceCents", "stock", "isActive"
      FROM "Product"
      WHERE "tenantId" = ${tenantId}
        AND "deletedAt" IS NULL
        AND ("name" ILIKE ${pattern} ESCAPE '\\'
             OR "sku" ILIKE ${pattern} ESCAPE '\\'
             OR "category" ILIKE ${pattern} ESCAPE '\\')
      ORDER BY "name" ASC
      LIMIT ${limit}
    `;
  }
}
