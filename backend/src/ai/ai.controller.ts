/**
 * AI administration endpoints (FR-AI-01, FR-AI-03).
 *
 * Provides operational endpoints for AI feature management:
 *   - GET /ai/status - Check AI provider configuration
 *   - GET /ai/stats - Get embedding statistics
 *   - POST /ai/reembed - Trigger re-embedding of all products
 *
 * These endpoints are administrative and require appropriate permissions.
 * The re-embed endpoint is async and returns immediately with a job ID.
 */
import { Controller, Get, Post, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { RequiresPermission } from '../access-control/access-control.decorators';
import { AI_PROVIDER } from './ai-provider.interface';
import type { AIProviderInterface } from './ai-provider.interface';
import {
  AIStatusResponse,
  AIStatsResponse,
  ReEmbedResponse,
} from './dto/ai-admin.dto';

/**
 * Controller for AI administrative operations.
 */
@Controller('ai')
export class AIController {
  private readonly logger = new Logger(AIController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly tenantContext: TenantContextService,
    @Inject(AI_PROVIDER) private readonly ai: AIProviderInterface,
  ) {}

  /**
   * GET /ai/status
   * Check if AI provider is configured and get configuration details.
   */
  @RequiresPermission('settings', 'read')
  @Get('status')
  getStatus(): AIStatusResponse {
    // Read API key only to detect "configured"; the value itself is never
    // sent back to the caller. isConfigured() is the canonical check.
    const hasApiKey = !!this.config.get<string>('AI_API_KEY');
    const baseUrl = this.config.get<string>('AI_API_BASE_URL');
    const embeddingModel = this.config.get<string>('AI_EMBEDDING_MODEL');
    const chatModel = this.config.get<string>('AI_CHAT_MODEL');

    let provider: string | null = null;
    if (this.ai.isConfigured() && hasApiKey) {
      provider = 'openai-compatible';
    }

    return {
      configured: this.ai.isConfigured(),
      provider,
      embeddingModel: embeddingModel ?? null,
      chatModel: chatModel ?? null,
      baseUrl: baseUrl ?? null,
    };
  }

  /**
   * GET /ai/stats
   * Get embedding statistics for the current tenant.
   */
  @RequiresPermission('settings', 'read')
  @Get('stats')
  async getStats(): Promise<AIStatsResponse> {
    const tenantId = this.tenantContext.getTenantId();
    if (!tenantId) {
      throw new Error('Tenant context not available');
    }

    // Count products using raw SQL since embedding columns are @ignore
    const [total, embedded, needingEmbedding, avgDimension] = await Promise.all(
      [
        this.prisma.$queryRaw<{ count: bigint }[]>`
          SELECT COUNT(*) as count
          FROM "Product"
          WHERE "tenantId" = ${tenantId} AND "deletedAt" IS NULL
        `,
        this.prisma.$queryRaw<{ count: bigint }[]>`
          SELECT COUNT(*) as count
          FROM "Product"
          WHERE "tenantId" = ${tenantId}
            AND "deletedAt" IS NULL
            AND "embedding" IS NOT NULL
        `,
        this.prisma.$queryRaw<{ count: bigint }[]>`
          SELECT COUNT(*) as count
          FROM "Product"
          WHERE "tenantId" = ${tenantId}
            AND "deletedAt" IS NULL
            AND "embeddingText" IS NOT NULL
            AND "embedding" IS NULL
        `,
        this.prisma.$queryRaw<{ avg: number | null }[]>`
          SELECT AVG(array_length("embedding"::text::float[], 1)) as avg
          FROM "Product"
          WHERE "tenantId" = ${tenantId}
            AND "deletedAt" IS NULL
            AND "embedding" IS NOT NULL
        `,
      ],
    );

    return {
      totalProducts: Number(total[0]?.count ?? 0),
      embeddedProducts: Number(embedded[0]?.count ?? 0),
      productsNeedingEmbedding: Number(needingEmbedding[0]?.count ?? 0),
      averageEmbeddingDimension: avgDimension[0]?.avg ?? null,
    };
  }

  /**
   * POST /ai/reembed
   * Trigger re-embedding of all products that need it.
   * This is an async operation that returns immediately.
   */
  @RequiresPermission('settings', 'write')
  @Post('reembed')
  async triggerReEmbed(): Promise<ReEmbedResponse> {
    const tenantId = this.tenantContext.getTenantId();
    if (!tenantId) {
      throw new Error('Tenant context not available');
    }

    if (!this.ai.isConfigured()) {
      throw new Error(
        'AI provider not configured. Set AI_API_KEY to enable embedding.',
      );
    }

    // Count products that need embedding
    const needingEmbedding = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) as count
      FROM "Product"
      WHERE "tenantId" = ${tenantId}
        AND "deletedAt" IS NULL
        AND "embeddingText" IS NOT NULL
        AND "embedding" IS NULL
    `;

    const jobId = this.generateJobId();
    const productsToProcess = Number(needingEmbedding[0]?.count ?? 0);

    this.logger.log(
      `Re-embed job ${jobId} started for tenant ${tenantId}: ${productsToProcess} products to process`,
    );

    // In a real implementation, this would queue a background job.
    // For now, we return immediately and the client can poll or use the CLI.
    // TODO: Implement proper job queue (BullMQ, etc.)

    return {
      jobId,
      message:
        'Re-embed job queued. Use the CLI (npm run ai:reembed) to process.',
      productsToProcess,
    };
  }

  /**
   * Generate a unique job ID for tracking async operations.
   */
  private generateJobId(): string {
    return `reembed-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  }
}
