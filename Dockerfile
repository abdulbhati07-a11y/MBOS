# =============================================================================
# MBOS Frontend Dockerfile
#
# Multi-stage build that consumes the Next 16 standalone output:
#
#   1. deps    — install ALL deps (build needs typescript + tailwind)
#   2. build   — `next build` writes .next/standalone/ (server.js + the
#                traced node_modules) and .next/static/ (client bundles).
#                NEXT_PUBLIC_* vars are inlined into the JS at this stage.
#   3. runtime — slim image: standalone + the two assets Next doesn't
#                trace (public/ and .next/static/) + a non-root server
#
# The standalone output is the standard Next 16 self-hosting target — see
# node_modules/next/dist/docs/01-app/01-getting-started/17-deploying.md
# and the linked examples/with-docker. The Dockerfile template below is
# the same shape, with project-specific build args for the API origin
# and the Server Function encryption key.
#
# Build args explained:
#   NEXT_PUBLIC_API_URL  — the origin the browser should call. Inlined at
#                          build time, so the same image cannot serve two
#                          different APIs; rebuild per environment.
#   NEXT_SERVER_ACTIONS_ENCRYPTION_KEY — base64 32-byte key. Next encrypts
#                          Server Function closures before sending them
#                          to the client; a different key per build means
#                          old encrypted Server Actions cannot be decrypted
#                          by the new server. Set a stable value so a
#                          rolling deploy does not break in-flight actions
#                          (see the self-hosting doc §"Server Functions
#                          encryption key").
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1 — full deps. The build needs devDeps (typescript, tailwind, the
# eslint stack, etc.); they are not carried into the runtime image.
# -----------------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# -----------------------------------------------------------------------------
# Stage 2 — produce the standalone bundle. ENV-first for the build args
# because `next build` reads them from the environment, not the CLI.
# -----------------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# ARGs need to be redeclared in each stage they are used. They are
# secrets-bearing for the encryption key (regenerate per deployment to
# force re-encryption), so accept them at build time only — the runtime
# image carries the inlined value, not the source.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=${NEXT_SERVER_ACTIONS_ENCRYPTION_KEY}

RUN npm run build

# -----------------------------------------------------------------------------
# Stage 3 — runtime. The standalone bundle is at /app/.next/standalone/ and
# already contains a copy of node_modules trimmed to the traced imports. We
# add the two artefacts Next does not trace (public/ for static files,
# .next/static/ for hashed client assets) and run as the non-root `node`
# user that ships with the base image.
# -----------------------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# standalone includes a server.js at the root of the .next/standalone dir.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public

USER node
EXPOSE 3000

# `node server.js` is the canonical standalone entry. No tini/dumb-init:
# Docker forwards SIGTERM to PID 1, Node's default handler begins the
# graceful drain (finish in-flight requests, run pending after() callbacks),
# and the self-hosting doc's recommended 10–30s drain window is enforced
# by compose's `stop_grace_period` rather than baked into the image.
CMD ["node", "server.js"]
