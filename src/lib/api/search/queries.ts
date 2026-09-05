// ---------------------------------------------------------------------------
// src/lib/api/search/queries.ts
//
// Read side of Smart Search (FR-AI-01, Phase 1).
//
// One endpoint, `GET /api/v1/search?q=…`, and the response is intentionally
// small — a SearchProductHit is a subset of Product: enough to render a row in
// the header dropdown, not enough to drive a drawer. Selecting a hit hands the
// id to the inventory module, which already owns product detail and edits.
//
// `engine` tells the dropdown how to frame the result: `vector` when a provider
// is configured and the search ran semantically, `text` when the backend fell
// back to ILIKE. The distinction is shown in the UI so an operator understands
// why two near-misses ranked the way they did, not so we can switch behaviour
// client-side. Per-hit `matchedBy`/`similarity` are the fine-grained signal.
// ---------------------------------------------------------------------------

import { api } from "../client"

export type SearchMatchedBy = "vector" | "text" | "exact"

export interface SearchProductHit {
  id: string
  name: string
  sku: string
  category: string
  /** Minor units (paisa under PKR). */
  priceCents: number
  stock: number
  isActive: boolean
  matchedBy: SearchMatchedBy
  /** Cosine similarity 0..1 for `vector` rows; null otherwise. */
  similarity: number | null
}

export interface SearchResponse {
  query: string
  /** Which engine answered: `text` when no provider is configured. */
  engine: "vector" | "text"
  products: SearchProductHit[]
}

export const searchKeys = {
  all: ["search"] as const,
  query: (q: string) => [...searchKeys.all, q] as const,
}

/**
 * The backend trims and validates `q` server-side; an empty string is rejected
 * with 422 and would surface as an error to the caller. The dropdown avoids
 * firing in that case itself.
 */
export function fetchSearch(
  q: string,
  signal?: AbortSignal,
): Promise<SearchResponse> {
  return api.get<SearchResponse>("/search", { query: { q }, signal })
}
