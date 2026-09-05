/**
 * Re-embed all products CLI script (DEBT-035 backfill).
 *
 * Run with: npm run ai:reembed
 *
 * This script backfills embeddings for products that have embeddingText but no
 * embedding vector. It's used when:
 *   - A new AI provider is configured and existing products need embeddings
 *   - The embedding model is changed and all products need re-embedding
 *   - Products were created while no provider was configured
 *
 * Design decisions:
 *   - Processes products in batches to avoid memory issues
 *   - Skips products without embeddingText (never had text to embed)
 *   - Skips products with existing embeddings (already embedded)
 *   - Respects tenant isolation: only processes products for each tenant
 *   - Logs progress and summary statistics
 *   - Continues on individual failures (logs but doesn't stop)
 */
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { buildPgConfig } from '../prisma/pg-config';
import { OpenAICompatibleAIProvider } from './openai-ai.provider';
import { NoopAIProvider } from './noop-ai.provider';

const logger = new Logger('ReEmbedAll');

// Batch configuration
const DEFAULT_BATCH_SIZE = 50;

/**
 * Main entry point for the re-embed script.
 */
async function main(): Promise<void> {
  logger.log('Starting re-embed all products script...');

  // Load configuration
  const config = new ConfigService();
  const batchSize = Number(
    config.get<string>('AI_REEMBED_BATCH_SIZE') ?? DEFAULT_BATCH_SIZE,
  );

  // Initialize Prisma client with pg adapter — same DATABASE_URL and optional
  // pinned CA (DATABASE_CA_CERT_PATH) as the Nest runtime and the seed.
  // See prisma/pg-config.ts.
  const prisma = new PrismaClient({
    adapter: new PrismaPg(buildPgConfig()),
  });

  try {
    // Initialize AI provider
    const apiKey = config.get<string>('AI_API_KEY');
    const aiProvider = apiKey
      ? new OpenAICompatibleAIProvider(config)
      : new NoopAIProvider();

    if (!aiProvider.isConfigured()) {
      logger.error(
        'No AI provider configured. Set AI_API_KEY to enable embedding. ' +
          'Use --dry-run to see what would be processed.',
      );
      process.exit(1);
    }

    logger.log(`Configuration: batchSize=${batchSize}`);

    // Get all tenants
    const tenants = await prisma.tenant.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
    });

    logger.log(`Found ${tenants.length} tenants to process`);

    // Process each tenant
    let totalProcessed = 0;
    let totalEmbedded = 0;
    let totalSkipped = 0;
    let totalFailed = 0;

    for (const tenant of tenants) {
      logger.log(`\nProcessing tenant: ${tenant.name} (${tenant.id})`);

      const tenantStats = await processTenant(
        prisma,
        aiProvider,
        tenant.id,
        batchSize,
      );

      totalProcessed += tenantStats.processed;
      totalEmbedded += tenantStats.embedded;
      totalSkipped += tenantStats.skipped;
      totalFailed += tenantStats.failed;

      logger.log(
        `Tenant ${tenant.name}: ${tenantStats.embedded} embedded, ` +
          `${tenantStats.skipped} skipped, ${tenantStats.failed} failed`,
      );
    }

    // Summary
    logger.log('\n=== Re-embed Summary ===');
    logger.log(`Tenants processed: ${tenants.length}`);
    logger.log(`Products processed: ${totalProcessed}`);
    logger.log(`Products embedded: ${totalEmbedded}`);
    logger.log(`Products skipped: ${totalSkipped}`);
    logger.log(`Products failed: ${totalFailed}`);

    if (totalFailed > 0) {
      logger.warn(
        `${totalFailed} products failed to embed. Check logs for details.`,
      );
    }

    if (totalEmbedded === 0) {
      logger.log(
        'No products needed embedding. All may already have embeddings.',
      );
    }

    logger.log('Re-embed script completed successfully!');
  } catch (error) {
    logger.error(
      `Re-embed script failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Process all products for a single tenant.
 */
async function processTenant(
  prisma: PrismaClient,
  aiProvider: OpenAICompatibleAIProvider | NoopAIProvider,
  tenantId: string,
  batchSize: number,
): Promise<{
  processed: number;
  embedded: number;
  skipped: number;
  failed: number;
}> {
  let processed = 0;
  let embedded = 0;
  let skipped = 0;
  let failed = 0;

  // Find products that need embedding (have text but no vector)
  // Note: embedding and embeddingText are @ignore in the schema, so we use raw SQL
  const productsToEmbed = await prisma.$queryRaw<
    { id: string; name: string; category: string; sku: string }[]
  >`
    SELECT id, name, category, sku
    FROM "Product"
    WHERE "tenantId" = ${tenantId}
      AND "deletedAt" IS NULL
      AND "embeddingText" IS NOT NULL
      AND "embedding" IS NULL
    LIMIT ${batchSize}
  `;

  if (productsToEmbed.length === 0) {
    logger.log(`No products need embedding for tenant ${tenantId}`);
    return { processed: 0, embedded: 0, skipped: 0, failed: 0 };
  }

  logger.log(
    `Found ${productsToEmbed.length} products to embed for tenant ${tenantId}`,
  );

  // Process in batches
  for (let i = 0; i < productsToEmbed.length; i += batchSize) {
    const batch = productsToEmbed.slice(i, i + batchSize);
    logger.log(
      `Processing batch ${i / batchSize + 1}: ${batch.length} products`,
    );

    for (const product of batch) {
      processed++;

      try {
        // Build the text to embed (same logic as EmbeddingService.productText)
        const text =
          `${product.name} ${product.category} ${product.sku}`.trim();

        // Generate embedding
        const vector = await aiProvider.generateEmbedding(text);

        // Update the product with the embedding
        await prisma.$executeRaw`
          UPDATE "Product"
          SET "embedding" = ${JSON.stringify(vector)}::vector,
              "embeddingText" = ${text}
          WHERE "id" = ${product.id} AND "tenantId" = ${tenantId}
        `;

        embedded++;
        logger.debug(`Embedded product ${product.id} (${product.name})`);
      } catch (error) {
        failed++;
        logger.error(
          `Failed to embed product ${product.id} (${product.name}): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  // Count skipped products (already have embeddings)
  const alreadyEmbedded = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) as count
    FROM "Product"
    WHERE "tenantId" = ${tenantId}
      AND "deletedAt" IS NULL
      AND "embedding" IS NOT NULL
  `;
  skipped = Number(alreadyEmbedded[0]?.count ?? 0);

  return { processed, embedded, skipped, failed };
}

// Run the script
main().catch((error) => {
  logger.error(
    `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
