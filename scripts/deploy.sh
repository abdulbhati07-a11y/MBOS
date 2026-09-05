#!/bin/sh
# =============================================================================
# MBOS release deploy — build, migrate once, then start.
#
# This script exists so the migration step cannot be skipped or duplicated.
# The backend container does NOT migrate on boot (see
# backend/docker-entrypoint.sh); migrations are applied here, exactly once
# per release, before any new container starts.
#
# Why that ordering matters:
#
#   * Security (DEBT-040). Prisma 7's schema engine connects over TLS but
#     does not verify the server's certificate chain. One run per deploy from
#     one known host is a single exposure window; a run on every container
#     boot of every replica was a continuous one.
#   * Correctness. One migration container runs regardless of replica count,
#     so no two processes ever race to apply DDL.
#
# Usage (from the repo root):
#
#   ./scripts/deploy.sh
#
# Against Supabase, the CA overlay must be active — either export
#   COMPOSE_FILE=docker-compose.yml:docker-compose.supabase.yml
# or pass the files through COMPOSE_FILE in your shell before running this.
# See docs/deployment.md §3.0.
#
# Env:
#   SKIP_BUILD=1   reuse the images already built (skip `docker compose build`)
# =============================================================================
set -eu

cd "$(dirname "$0")/.."

if [ ! -f .env.production ]; then
  echo "deploy: .env.production not found — copy .env.production.example and fill it in." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 1. Build. NEXT_PUBLIC_API_URL is baked into the frontend bundle here, so
#    .env.production must already hold the right value.
# ---------------------------------------------------------------------------
if [ "${SKIP_BUILD:-}" = "1" ]; then
  echo "==> [1/3] build skipped (SKIP_BUILD=1)"
else
  echo "==> [1/3] building images"
  docker compose build
fi

# ---------------------------------------------------------------------------
# 2. Migrate — once, in its own container, before anything serves traffic.
#    `set -e` aborts the script if this exits non-zero, so a failed migration
#    never rolls out a new app version against an old schema.
# ---------------------------------------------------------------------------
echo "==> [2/3] applying migrations (one-shot)"
docker compose --profile migrate run --rm migrate

# ---------------------------------------------------------------------------
# 3. Start. Only reached when the migration succeeded.
# ---------------------------------------------------------------------------
echo "==> [3/3] starting services"
docker compose up -d

echo
echo "Deploy complete. Check readiness with:"
echo "  docker compose ps"
echo "  docker compose logs -f backend"
