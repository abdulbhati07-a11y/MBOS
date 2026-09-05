import { IsOptional, IsString, MinLength } from 'class-validator';

/**
 * `GET /search?q=…` — Smart Search (Phase 1).
 *
 * One required term, capped at the same length as every other free-text
 * filter. `MinLength(1)` after the controller trims: an empty term would match
 * everything in the catalogue and is not a search.
 */
export class SearchQueryDto {
  @IsString()
  @MinLength(1)
  @IsOptional()
  q?: string;
}

/** One product hit. Deliberately a small projection, not ProductResponse. */
export interface SearchProductHit {
  id: string;
  name: string;
  sku: string;
  category: string;
  /** Minor units (paisa under PKR). */
  priceCents: number;
  stock: number;
  isActive: boolean;
  /**
   * How this row matched: `vector` (semantic similarity over the embedded
   * catalogue), `text` (ILIKE fallback), or `exact` (SKU prefix hit promoted
   * regardless of embedding state).
   */
  matchedBy: 'vector' | 'text' | 'exact';
  /** Cosine similarity 0..1 for `vector` rows; null otherwise. */
  similarity: number | null;
}

export interface SearchResponse {
  query: string;
  /** Which engine answered. `text` when nothing is embedded / no provider. */
  engine: 'vector' | 'text';
  products: SearchProductHit[];
}
