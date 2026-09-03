/**
 * DTOs for AI administration endpoints.
 */
import { IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';

/**
 * Response for GET /ai/status - AI provider configuration status.
 */
export class AIStatusResponse {
  /** Whether an AI provider is configured and available. */
  @IsBoolean()
  configured: boolean;

  /** The provider type (e.g., 'openai-compatible', null if not configured). */
  @IsString()
  @IsOptional()
  provider: string | null;

  /** The embedding model being used. */
  @IsString()
  @IsOptional()
  embeddingModel: string | null;

  /** The chat/completion model being used. */
  @IsString()
  @IsOptional()
  chatModel: string | null;

  /** The base URL for the AI API. */
  @IsString()
  @IsOptional()
  baseUrl: string | null;
}

/**
 * Response for GET /ai/stats - Embedding statistics for the current tenant.
 */
export class AIStatsResponse {
  /** Total number of products in the tenant. */
  @IsNumber()
  totalProducts: number;

  /** Number of products with embeddings. */
  @IsNumber()
  embeddedProducts: number;

  /** Number of products that need embedding (have text but no vector). */
  @IsNumber()
  productsNeedingEmbedding: number;

  /** Average embedding dimension (null if no embeddings). */
  @IsNumber()
  @IsOptional()
  averageEmbeddingDimension: number | null;
}

/**
 * Response for POST /ai/reembed - Re-embed job status.
 */
export class ReEmbedResponse {
  /** Unique job identifier. */
  @IsString()
  jobId: string;

  /** Human-readable message about the job. */
  @IsString()
  message: string;

  /** Number of products that will be processed. */
  @IsNumber()
  productsToProcess: number;
}
