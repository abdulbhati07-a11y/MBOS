#!/bin/sh
# =============================================================================
# MBOS backend entrypoint
#
# Why a script and not a compose command: compose can only declare a single
# command for a service. We need to run `prisma migrate deploy` and then
# `node dist/main.js` in the same container, and a failure of the first
# must not silently start the API on an outdated schema. The script makes
# the order explicit and the failure mode loud.
#
# `migrate deploy` is idempotent: after the first boot it is a no-op when
# the migration set is unchanged. On a schema change it will apply new
# migrations and the API will start with the new types. If the database is
# unreachable, the command exits non-zero, Docker restarts the container
# per its restart policy, and the readiness probe keeps failing — which is
# what we want: the backend should never serve traffic on a stale schema.
# =============================================================================
set -eu

# Echo every step to the container log so an operator watching `docker
# compose logs -f backend` can see which migrations applied.
echo "[entrypoint] applying Prisma migrations…"
npx prisma migrate deploy --schema=prisma/schema.prisma

echo "[entrypoint] starting API…"
exec node dist/main.js
