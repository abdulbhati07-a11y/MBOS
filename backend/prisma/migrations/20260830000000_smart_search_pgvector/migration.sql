-- Smart Search (Phase 1, FR-AI-01-adjacent).
--
-- pgvector must exist before the embedding column can. `CREATE EXTENSION` is
-- idempotent (IF NOT EXISTS), so re-running the migration set is safe. The
-- extension must be available on the instance (verified available on the dev
-- Postgres 17.6 host during the Phase 1 investigation; DigitalOcean managed
-- Postgres ships it; a self-managed Hetzner host must install
-- postgresql-17-pgvector first).
CREATE EXTENSION IF NOT EXISTS vector;

-- Product embedding: one vector per live product, written by the application
-- on create/update (no queue exists in this codebase by design — the Phase 1
-- decision — so generation is inline in the write path).
--
-- The dimension (1536, matching OpenAI's text-embedding-3-small) is the one
-- place the provider choice touches the schema. Changing providers or
-- dimensions later means a new migration that drops this column and its index
-- and re-embeds the catalogue — a decision recorded in DOCUMENTATION_DEBT.md
-- (DEBT-035). NULL = not yet embedded (no provider configured, or the text
-- changed while the provider was down — see EmbeddingService).
ALTER TABLE "Product" ADD COLUMN "embedding" vector(1536);

-- Text the embedding was generated from. Written with the vector, so a stale
-- row can be detected by comparing this against the product's current
-- name+category+sku without re-embedding anything to know it is stale.
ALTER TABLE "Product" ADD COLUMN "embeddingText" TEXT;

-- Cosine-distance index over every embedded row. `partial WHERE` keeps the
-- index (and its build/maintenance cost) to rows that actually carry a vector;
-- NULLs are the common state until a provider is configured, and they would be
-- dead weight in an HNSW index.
-- Lists=100 is pgvector's suggested starting point for up to ~1M rows; a
-- tenant catalogue is orders of magnitude smaller, where lists barely matters.
CREATE INDEX "Product_embedding_idx"
  ON "Product" USING hnsw ("embedding" vector_cosine_ops)
  WHERE "embedding" IS NOT NULL;
