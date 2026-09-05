#!/bin/sh
# =============================================================================
# MBOS backend entrypoint
#
# This container starts the API and NOTHING ELSE. It does NOT run
# `prisma migrate deploy`.
#
# Migrations are applied once per release by the separate `migrate` one-shot
# (docker-compose.yml, `--profile migrate`) BEFORE these containers start —
# never from here. Two reasons:
#
#   1. Security (DEBT-040). Prisma 7's schema engine connects to the database
#      over TLS but does not verify the server certificate chain. Running it
#      from every container boot of every replica exposed that unverified
#      connection continuously; running it once per deploy from one known
#      host narrows the window to a single event. See DOCUMENTATION_DEBT.md.
#
#   2. Correctness. With N replicas, migrate-at-boot means N processes racing
#      to apply DDL on startup. Removing it from boot makes that race
#      structurally impossible — no replica ever touches the schema.
#
# If the schema is behind the code (a migration was not applied before the
# new image rolled out), the app will fail against the old schema and the
# readiness probe will stay red — which is the loud failure we want, not a
# silent self-migration.
# =============================================================================
set -eu

echo "[entrypoint] starting API…"
exec node dist/main.js
