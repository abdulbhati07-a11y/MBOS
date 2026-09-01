# =============================================================================
# MBOS Backend Dockerfile
#
# Multi-stage build:
#   1. deps     — install ALL deps (build needs devDeps for nest + typescript)
#   2. build    — `prisma generate` (writes the client into src/generated/prisma,
#                 declared by the schema's `output = "../src/generated/prisma"`)
#                 then `nest build` (writes dist/)
#   3. prod-deps — re-install prod-only deps into a fresh layer
#   4. runtime  — slim image: prod node_modules + dist + generated prisma client
#                 + migrations + the migrate-then-boot entrypoint
#
# Why a multi-stage layout and not `npm ci --omit=dev` in a single stage:
# `nest build` and `prisma generate` need typescript, the nest CLI, and the
# @types/* devDeps. They cannot run in a prod-deps image. Pruning devDeps
# after the build is a non-starter because `npm prune` doesn't shrink the
# layer the build wrote — the layer is already sealed.
#
# The migrate-deploy step runs on every container start, but Prisma records
# applied migrations in `_prisma_migrations`, so it is a no-op after the
# first boot. If the database is unreachable, the entrypoint exits and Docker
# restarts the container until the DB answers — that is the desired
# behaviour: the backend should never start ahead of its data store.
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1 — install every dependency, including devDeps, so the next stage
# can build. The devDeps are NOT carried into the runtime image.
# -----------------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app

# Prisma 7's CLI looks for a query engine binary in the standard paths. The
# pg driver adapter (@prisma/adapter-pg) removes that requirement at runtime,
# but the CLI itself still wants the engine when it parses a schema. The
# `engine-studio` and `queryEngine` binaries are bundled in the
# `node_modules/prisma` install — no separate download step is required.
# (If a future Prisma version changes this, add `PRISMA_HIDE_UPDATE_MESSAGE=1`
# and `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1` here, then run
# `npx prisma generate` offline.)
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# -----------------------------------------------------------------------------
# Stage 2 — produce dist/ and the generated Prisma client. We re-use the
# deps layer so node_modules is already in place; `nest build` and
# `prisma generate` only write to ./dist and ./src/generated/prisma.
# -----------------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate the Prisma client into src/generated/prisma (the schema's
# `output = "../src/generated/prisma"`). `nest build` does not run this —
# the generated client is committed to source-tree in dev but excluded by
# backend/.gitignore, so the image is the only place it must be produced
# at build time. Reads DATABASE_URL is not required for generate.
RUN npx prisma generate

# nest build compiles src/ to dist/ (tsconfig.build.json excludes tests).
RUN npm run build

# -----------------------------------------------------------------------------
# Stage 3 — a clean install of prod deps only. A new layer guarantees that
# nothing from the build stage leaks into the runtime image.
# -----------------------------------------------------------------------------
FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
# `--omit=dev` is the npm 10 spelling of the older `--production` flag.
RUN npm ci --omit=dev --no-audit --no-fund

# -----------------------------------------------------------------------------
# Stage 4 — runtime image. Carries the dist/ tree, the generated Prisma
# client, the migration history, and the entrypoint. Nothing else.
# -----------------------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# The image ships with a non-root `node` user (uid 1000). chown only what
# we need to be writable at runtime — the rest stays root-owned and
# read-only to the worker. The HOME default is /home/node, which is what
# Prisma uses as a scratch directory for engine artefacts at runtime.
COPY --chown=node:node --from=prod-deps /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node --from=build /app/src/generated ./src/generated
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node package.json ./package.json
COPY --chown=node:node docker-entrypoint.sh ./docker-entrypoint.sh

USER node

EXPOSE 3001

# `migrate deploy` is the right command for production: it applies pending
# migrations without prompting and refuses to run if the migration history
# has drifted. The compose file expects the backend to be healthy only
# after this step, and that healthcheck (below) pings the actual API.
ENTRYPOINT ["sh", "./docker-entrypoint.sh"]

# Readiness, not liveness: the orchestrator (compose healthcheck, or a
# load balancer) gates traffic on this. A liveness check that touches the
# DB would restart the container every time Postgres hiccupped, which is
# not what you want — the connection pool survives a brief DB blip. Use a
# short interval so a green container does not advertise readiness during
# a long initial migration.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/api/v1/health/ready || exit 1
