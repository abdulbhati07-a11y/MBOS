import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { AI_PROVIDER } from './ai-provider.interface';
import type { AIProviderInterface } from './ai-provider.interface';
import { PrismaService } from '../prisma/prisma.service';

/** How long one provider embedding call may take before we give up on it. */
const EMBED_TIMEOUT_MS = 10_000;

/** How long shutdown waits for outstanding embedding work to finish. */
const DRAIN_TIMEOUT_MS = 15_000;

/**
 * Text embedding for Smart Search (Phase 1).
 *
 * Exists to solve exactly one problem: keeping `Product.embedding` in step with
 * the text it was generated from, across every write path, without a queue.
 * (No BullMQ/Redis exists in this codebase — the Phase 1 investigation
 * confirmed the premise false — so embedding is out-of-band, fail-soft: an
 * embedding problem must never fail a product write, because search is an
 * enhancement and stock-keeping is the business.)
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
 *
 * ## Detached, but tracked — not fire-and-forget
 *
 * Write paths must not wait on a network embedding call, so the work is
 * detached from the request. It is NOT, however, abandoned. Callers use
 * {@link syncProductDetached} / {@link clearProductDetached}, which register the
 * promise in {@link inFlight}; {@link onModuleDestroy} drains that set (bounded)
 * when Nest shuts down.
 *
 * The previous shape — a bare `void this.embedding.syncProduct(...)` at the call
 * site — leaked work past the end of the request that started it. In tests that
 * showed up as Jest reporting "a worker process has failed to exit gracefully":
 * `app.close()` returned while an embedding UPDATE and its HTTP socket were
 * still open. It is a real bug against any provider, not just a live one — an
 * async call that outlives its caller holds a database handle nobody is waiting
 * on and can write after the row it targets has been deleted.
 */
@Injectable()
export class EmbeddingService implements OnModuleDestroy {
  private readonly logger = new Logger(EmbeddingService.name);

  /** Detached embedding work that has not settled yet. Drained on shutdown. */
  private readonly inFlight = new Set<Promise<void>>();

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
   * Start an embedding sync without blocking the caller, but keep hold of the
   * promise so shutdown can wait for it. This is what write paths call.
   */
  syncProductDetached(
    tenantId: string,
    product: { id: string; name: string; category: string; sku: string },
  ): void {
    this.track(this.syncProduct(tenantId, product));
  }

  /** Detached counterpart of {@link clearProduct}. See above. */
  clearProductDetached(tenantId: string, productId: string): void {
    this.track(this.clearProduct(tenantId, productId));
  }

  /**
   * Registers a detached promise and removes it once settled. `syncProduct` and
   * `clearProduct` never reject, but the `.catch` stays as a belt-and-braces
   * guard: an unhandled rejection here would take the process down.
   */
  private track(work: Promise<void>): void {
    const tracked = work
      .catch((err: unknown) => {
        this.logger.warn(
          `Detached embedding task failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      })
      .finally(() => {
        this.inFlight.delete(tracked);
      });
    this.inFlight.add(tracked);
  }

  /**
   * Wait for outstanding embedding work before the module goes away, so a
   * shutdown (or a test's `app.close()`) does not leave open handles behind.
   * Bounded: a wedged provider delays shutdown by at most DRAIN_TIMEOUT_MS.
   */
  async onModuleDestroy(): Promise<void> {
    if (this.inFlight.size === 0) return;

    const pending = [...this.inFlight];
    this.logger.log(
      `Draining ${pending.length} in-flight embedding task(s) before shutdown…`,
    );

    const settled = await withTimeout(
      Promise.allSettled(pending).then(() => true),
      DRAIN_TIMEOUT_MS,
    );

    if (settled === TIMED_OUT) {
      this.logger.warn(
        `Embedding drain timed out after ${DRAIN_TIMEOUT_MS}ms with ` +
          `${this.inFlight.size} task(s) outstanding; abandoning them.`,
      );
    }
  }

  /**
   * Embed one product after a successful create/update. Call from the write
   * path with the post-commit row. Never throws.
   *
   * Prefer {@link syncProductDetached} from a request path — awaiting this puts
   * a provider round-trip on the response's critical path.
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
      // Bounded: an unresponsive provider must not hold this task open
      // indefinitely, because shutdown waits on it. This bounds our *waiting*,
      // not the underlying request — the provider is responsible for its own
      // socket timeout — but it is what keeps the drain finite.
      const vector = await withTimeout(
        this.ai.generateEmbedding(text),
        EMBED_TIMEOUT_MS,
      );

      if (vector === TIMED_OUT) {
        this.logger.warn(
          `Embedding timed out after ${EMBED_TIMEOUT_MS}ms for product ${product.id}; leaving the vector stale.`,
        );
        return;
      }

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

/** Sentinel returned by {@link withTimeout} instead of throwing on timeout. */
const TIMED_OUT = Symbol('TIMED_OUT');

/**
 * Resolve to the promise's value, or to {@link TIMED_OUT} after `ms`.
 *
 * The timer is always cleared, including on the success path — a stray pending
 * `setTimeout` keeps Node's event loop alive and would reintroduce exactly the
 * dangling-handle symptom this file is fixing.
 */
async function withTimeout<T>(
  work: Promise<T>,
  ms: number,
): Promise<T | typeof TIMED_OUT> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
