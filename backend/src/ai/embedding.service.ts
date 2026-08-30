import { Inject, Injectable, Logger } from '@nestjs/common';
import { AI_PROVIDER } from './ai-provider.interface';
import type { AIProviderInterface } from './ai-provider.interface';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Text embedding for Smart Search (Phase 1).
 *
 * Exists to solve exactly one problem: keeping `Product.embedding` in step with
 * the text it was generated from, across every write path, without a queue.
 * (No BullMQ/Redis exists in this codebase — the Phase 1 investigation
 * confirmed the premise false — so embedding is synchronous, inline, and
 * fail-soft: an embedding problem must never fail a product write, because
 * search is an enhancement and stock-keeping is the business.)
 *
 * Design points the write paths rely on:
 *
 *   - `syncProduct` is called AFTER the transaction commits. Embedding inside
 *     the transaction would (a) hold a write lock across a network call, and
 *     (b) embed text the transaction might still roll back.
 *   - When no provider is configured, the vector stays NULL and `embeddingText`
 *     is updated anyway — so a later provider activation can find and embed
 *     every stale row in one backfill pass, with no separate "needs embedding"
 *     flag.
 *   - All SQL is parameterised (`$executeRaw` with bind parameters — never
 *     string interpolation) and filters by tenantId explicitly, because the
 *     tenant-scoping Prisma extension does not wrap `$executeRaw`/`$queryRaw`.
 *     Every query here takes the tenantId as an argument for that reason.
 */
@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(AI_PROVIDER) private readonly ai: AIProviderInterface,
  ) {}

  /** The exact text an embedding is computed from. Deterministic by design. */
  productText(p: { name: string; category: string; sku: string }): string {
    // SKU last: for "wireless mouse" the words that carry meaning are the
    // name and category; the SKU is an exact-match concern the existing
    // `?search=` already covers, and here it only disambiguates variants.
    return `${p.name} ${p.category} ${p.sku}`.trim();
  }

  /**
   * Embed one product after a successful create/update. Call from the write
   * path with the post-commit row. Never throws.
   */
  async syncProduct(
    tenantId: string,
    product: { id: string; name: string; category: string; sku: string },
  ): Promise<void> {
    const text = this.productText(product);

    // Provider unconfigured: record the text so a later activation can backfill
    // by comparing `embeddingText` against the current product text. The vector
    // stays NULL; search falls back to text matching for un-embedded rows.
    if (!this.ai.isConfigured()) {
      try {
        await this.prisma.$executeRaw`
          UPDATE "Product"
          SET "embeddingText" = ${text}
          WHERE "id" = ${product.id} AND "tenantId" = ${tenantId}
        `;
      } catch (err) {
        this.logger.warn(
          `Embedding text sync failed for product ${product.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return;
    }

    try {
      const vector = await this.ai.generateEmbedding(text);
      // pgvector's text cast: the array is serialised and cast to the column
      // type server-side. Parameterised — the JSON text is data, never SQL.
      await this.prisma.$executeRaw`
        UPDATE "Product"
        SET "embedding" = ${JSON.stringify(vector)}::vector,
            "embeddingText" = ${text}
        WHERE "id" = ${product.id} AND "tenantId" = ${tenantId}
      `;
    } catch (err) {
      // Fail-soft: log and leave the row NULL/stale. Search falls back to text
      // matching for un-embedded rows (see SearchService), so nothing breaks.
      this.logger.warn(
        `Embedding sync failed for product ${product.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Clear a product's embedding when it is soft-deleted (its text left the
   * searchable catalogue). Read paths already filter deletedAt; this keeps the
   * vector index free of dead rows.
   */
  async clearProduct(tenantId: string, productId: string): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        UPDATE "Product"
        SET "embedding" = NULL, "embeddingText" = NULL
        WHERE "id" = ${productId} AND "tenantId" = ${tenantId}
      `;
    } catch (err) {
      this.logger.warn(
        `Embedding clear failed for product ${productId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
