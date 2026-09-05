# Deployment

> **Document status:** Runbook. Reflects the Docker packaging in the repo
> root (`Dockerfile`, `docker-compose.yml`, `.env.production.example`,
> `scripts/deploy.sh`, `backend/Dockerfile`,
> `backend/docker-entrypoint.sh`). Cross-references
> Section 4.8 of the spec; supersedes any in-line "deployment" notes in
> earlier sections.

This document is the operator runbook for getting MBOS from a fresh
checkout to a running stack. It assumes Linux (or WSL2 on Windows); macOS
is the same commands.

---

## 1. What you deploy

A two-container application plus a managed Postgres:

| Service  | Image                | Port (host)   | Role                                            |
| -------- | -------------------- | ------------- | ----------------------------------------------- |
| backend  | `mbos-backend`       | 3001          | NestJS API, mounted at `/api/v1`                |
| frontend | `mbos-frontend`      | 3000          | Next.js 16 standalone server, serves the app    |
| db       | (Supabase)           | —             | Managed Postgres; the backend connects directly |

TLS termination is a **reverse proxy's** job, not the containers'. Caddy
or nginx in front, with automatic certificate renewal (Let's Encrypt
via Caddy, certbot + nginx elsewhere), is the recommended shape. The
backend's `secure` cookie flag turns on automatically in
`NODE_ENV=production` — so a real deploy MUST terminate TLS before any
browser reaches the API, or the refresh cookie is dropped.

> **Note on the database:** The production database is **Supabase**.
> Compose does not include a `db` service by default. A `local-db`
> profile is provided for fully-local development; production should
> point `DATABASE_URL` at Supabase directly.

---

## 2. One-time setup

### 2.1 Prerequisites

- Docker Engine 24+ and the Docker Compose plugin v2 (`docker compose`).
- A Supabase project. The free tier is sufficient for a dev/staging run;
  Pro is recommended for production traffic. Note the project ref and
  database password from the dashboard.
- A domain (or subdomain) you control, pointed at the host that will
  run the stack. A record for `app.yourdomain.com` and (recommended)
  `api.yourdomain.com`.
- A reverse proxy. Caddy is the simplest choice — see §7.

### 2.2 Generate secrets

The backend's boot-time env validation refuses to start with placeholder
or example values in production (see
`backend/src/config/env-validation.ts`). Generate real secrets once and
store them in a password manager; the same secrets are reused across
restarts.

```bash
# JWT secrets — 64 random bytes, hex-encoded (128 chars). Two distinct values.
node -e "console.log('JWT_ACCESS_SECRET=' + require('crypto').randomBytes(64).toString('hex'))"
node -e "console.log('JWT_REFRESH_SECRET=' + require('crypto').randomBytes(64).toString('hex'))"

# Next.js Server Function encryption key — 32 random bytes, base64-encoded.
# Stable per environment (do not regenerate on every deploy).
node -e "console.log('NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('base64'))"
```

### 2.3 Configure `.env.production`

```bash
cp .env.production.example .env.production
$EDITOR .env.production
```

Fill in:

- `DATABASE_URL` — the Supabase **direct** connection string (port 5432,
  `?sslmode=require`). The format is
  `postgresql://postgres.PROJECT_REF:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres?sslmode=require`.
  Get the real values from the Supabase dashboard: *Project Settings →
  Database → Connection string → Direct*. Replace the password field.
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` — from §2.2.
- `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` — from §2.2.
- `CORS_ORIGIN` — the public frontend origin. Comma-separated if you
  serve the same backend from multiple frontends (staging + production,
  for example). **Never** leave the default `https://app.yourdomain.com`
  in place if your real frontend is at a different origin; the
  validation will fail loudly rather than silently break.
- `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` /
  `PASSWORD_RESET_URL` — your transactional mail provider's details.
  The reset link is the URL the user clicks in the password-reset
  email. If these are unset, password reset still works but only logs
  to stdout (the console stub).
- `NEXT_PUBLIC_API_URL` — the public API origin the browser calls.
  This is inlined into the JS bundle at **build time**, so changing it
  after the image is built has no effect; rebuild the frontend image.

`SEED_DEV_TENANT="false"` is the default; the dev tenant + dev user
(`owner@dev.local`) are skipped in production. Built-in roles, plans,
and permissions always seed.

### 2.4 Reverse proxy

A minimal Caddyfile, terminating TLS and forwarding to the containers:

```caddyfile
# Replace with your real domain.
app.yourdomain.com, api.yourdomain.com {
    @api path /api/v1/*
    reverse_proxy @api backend:3001

    reverse_proxy frontend:3000
}
```

`backend:3001` and `frontend:3000` are the compose-internal hostnames —
Caddy must be on the same Docker network as the stack. The simplest
setup is to run Caddy in its own container on the `mbos_default`
network (`docker network connect mbos_default caddy`).

---

## 3. Build and start

**If your database is Supabase, do §3.0 first** — otherwise the commands
below connect without a trust anchor and fail.

### 3.0 Supabase: the CA overlay

Supabase's cert chains to a private root Node does not ship, so the root
has to be pinned. Download it once
(*Project Settings → Database → Connection string → SSL Certificate →
Download*), save it as `backend/supabase-ca.crt` — full walkthrough in
[supabase-setup.md](./supabase-setup.md) — then make the overlay that
mounts it apply to **every** compose command, including the migration
one-shot. Set this once in a root `.env` (compose reads that file for its
own configuration):

```bash
COMPOSE_FILE=docker-compose.yml:docker-compose.supabase.yml
```

Every command in this document — and inside `scripts/deploy.sh` — then
works unchanged, cert included. On Windows the path separator is `;`
rather than `:`, or set `COMPOSE_PATH_SEPARATOR=:`.

Passing the files by hand works too, but you must pass them to the
migration step as well as to `up`, which is why `COMPOSE_FILE` is the
recommended route:

```bash
docker compose -f docker-compose.yml -f docker-compose.supabase.yml \
  --profile migrate run --rm migrate
docker compose -f docker-compose.yml -f docker-compose.supabase.yml up -d
```

The cert is not in the base compose file because compose has no optional
bind mount — naming an absent host file would break `up` for every
deployment that does not need a private CA. It is gitignored, so each
deployment downloads its own rather than inheriting one that will go
stale.

Skip this section entirely for stock Postgres, the `local-db` profile, or
any provider with a publicly-trusted cert.

### 3.1 Build, migrate, start

Migrations are **their own step**, and they run **before** the containers
that serve traffic. The backend image does not migrate on boot — see
§3.2 for why. `scripts/deploy.sh` encodes the whole sequence and aborts
before starting anything if the migration fails:

```bash
./scripts/deploy.sh
```

Equivalently, by hand:

```bash
# 1. Build images. The frontend build bakes NEXT_PUBLIC_API_URL into the
#    bundle — make sure .env.production has the right value before this.
docker compose build

# 2. Apply migrations, once, in a throwaway container that exits when done.
#    REQUIRED on any release that adds a migration. Not optional.
docker compose --profile migrate run --rm migrate

# 3. Start the app. Only do this after step 2 exited 0.
docker compose up -d

# Watch the backend boot.
docker compose logs -f backend
```

A successful boot ends with `[entrypoint] starting API…` and the
`backend` service reporting `healthy` in `docker compose ps`.

`SKIP_BUILD=1 ./scripts/deploy.sh` reuses the images already built, for a
redeploy that only changes environment.

To check what a migration step *would* do before running it — same image,
same env, read-only:

```bash
docker compose --profile migrate run --rm --entrypoint sh migrate \
  -c "npx prisma migrate status --schema=prisma/schema.prisma"
```

### 3.2 Why migrations are not part of container start

They used to be, via `backend/docker-entrypoint.sh`. Two problems made
that the wrong shape:

- **Unverified TLS on the migration connection (DEBT-040).** Prisma 7's
  schema engine connects to Postgres over TLS but does not verify the
  server's certificate chain — no combination of `sslmode`,
  `sslrootcert`, `sslcert` or `PGSSLROOTCERT` changes that, and the
  `prisma.config.ts` `adapter` hook that would have fixed it was removed
  in v7. Running it from every container start of every replica left that
  unverified connection happening continuously. Running it once per
  deploy narrows the window to a single event. The application's own
  runtime pool is unaffected: it pins the CA and verifies (see §7).
- **N replicas racing on DDL.** With migrate-at-boot, scaling the backend
  to *n* containers meant *n* processes attempting migrations at once.
  Prisma's advisory lock serialises them, but the correct fix is for no
  replica to touch the schema at all.

The consequence to be aware of: nothing now auto-applies a pending
migration. If you roll out an image whose code expects a column that was
never migrated, the app will fail against the old schema and readiness
will stay red. That is the intended loud failure, but it does mean the
migrate step is not skippable. Use `scripts/deploy.sh` rather than a bare
`docker compose up -d`.

### 3.3 Local development (no Supabase)

For a fully-local stack with a Postgres in Docker, override
`DATABASE_URL` and start the `local-db` profile:

```bash
# .env.local-dev at the repo root, gitignored
DATABASE_URL="postgresql://mbos:mbos@db:5432/mbos?schema=public"
CORS_ORIGIN="http://localhost:3000"
NEXT_PUBLIC_API_URL="http://localhost:3001"
# ...and any other vars you need

docker compose --profile local-db --env-file .env.local-dev up
```

The `local-db` profile brings up `pgvector/pgvector:pg17` on the
`mbos_default` network; the backend reaches it at `db:5432`.

---

## 4. First-run seeding

Built-in roles, plans, and permissions are NOT seeded automatically —
Prisma 7 dropped the auto-seed hook. Run the seed explicitly on the
first start (and any time the role matrix or plan catalogue changes):

```bash
docker compose exec backend node dist/prisma/seed.js
```

The seed is idempotent (upserts on the natural unique columns) and
authoritative for the built-in roles — see the file header in
`backend/src/prisma/seed.ts`. It refuses to create the dev tenant when
`SEED_DEV_TENANT=false` or `NODE_ENV=production`. To create the first
user for a new tenant, sign in through the frontend and use the
registration flow; the tenant-create + owner-bootstrap is the standard
path.

---

## 5. Smoke checks

A checklist to run after the stack is up:

1. **API liveness** — `curl -fsS http://localhost:3001/api/v1/health`
   returns `MBOS API is running`.
2. **API readiness** —
   `curl -fsS http://localhost:3001/api/v1/health/ready` returns
   `{"status":"ok","db":"up"}`. A 503 with `db:"down"` means the
   backend cannot reach the Supabase project — check `DATABASE_URL`
   and the Supabase project's network access list.
3. **Frontend** — `curl -fsSI http://localhost:3000/` returns `200 OK`.
4. **End-to-end auth** — open the frontend in a browser, log in, create
   a customer, place an order, refresh. The dashboard reflects the new
   data.
5. **Tenant isolation spot-check** — create a second tenant in the
   Supabase dashboard (or via the registration flow), log in, confirm
   that no data from the first tenant is visible.
6. **Password reset email** — request a reset from the frontend
   login page. With SMTP configured, the email arrives within a few
   seconds. Without SMTP, the same call is logged to the backend's
   stdout and a token appears in the log line — never in the response.

---

## 5b. AI features (optional)

The AI features (Smart Search, Dashboard Health Insights) are
**off by default** and degrade to non-AI behaviour when unconfigured
(FR-AI-01). Enabling them is a four-step process; skipping any step
leaves the feature on its fallback path.

### 5b.1 Configuration

Set the four env vars on the backend container, then restart:

| Variable               | Required | Default                       | Notes                                                |
| ---------------------- | -------- | ----------------------------- | ---------------------------------------------------- |
| `AI_API_KEY`           | yes      | (unset)                       | The provider key. Empty/unset keeps AI off.          |
| `AI_API_BASE_URL`      | no       | `https://api.openai.com/v1`   | OpenAI-compatible. Use for self-hosted gateways.     |
| `AI_EMBEDDING_MODEL`   | no       | `text-embedding-3-small`      | Output dim must match `vector(N)` in the schema.     |
| `AI_CHAT_MODEL`        | no       | `gpt-4o-mini`                 | Any chat model the provider accepts.                 |

The factory in `backend/src/ai/ai.module.ts` reads `AI_API_KEY` once at
process start. The class it binds (`OpenAICompatibleAIProvider` if
the key is set, `NoopAIProvider` otherwise) is fixed for the life of
the process. To change providers you must restart the backend
(DEBT-038).

### 5b.2 Database prerequisites

The `Product.embedding` column is `vector(1536)`, sized for
`text-embedding-3-small`. This is part of the schema, so the column
and its HNSW index already exist in production once the
`20260830000000_smart_search_pgvector` migration has run. No extra
step is needed for Supabase: the migration is a no-op if pgvector
is already enabled and creates the extension otherwise.

> **Managed Postgres note:** the `vector` extension is not part of
> stock Postgres 17. On Supabase it is available out of the box; on a
> self-hosted Postgres, install the matching
> `postgresql-17-pgvector` package before the first migration. See
> DEBT-035 for the full list of providers where this is and is not
> already installed.

### 5b.3 Data disclosure (FR-AI-02)

Enabling AI means tenant data leaves the backend and goes to the
configured provider. The OpenAI provider's class-level docstring
(`backend/src/ai/openai-ai.provider.ts`) lists exactly what is sent
per method:

- `generateEmbedding` — product name, category, SKU, and the
  user's search query.
- `complete` / `generateInsights` — business aggregates
  (counts, money totals) passed in the prompt.
- `generateSuggestion` — the user prompt, which may include
  business context.

This is a **per-tenant disclosure** and must be surfaced in the
operator's privacy notice and in the tenant onboarding flow. There
is no per-request opt-out today (DEBT-038); a tenant that must
not have its data sent to a third party should run on a deployment
where `AI_API_KEY` is not set.

### 5b.4 Backfilling existing products

Products created while AI was off have `embeddingText` set but
`embedding` null. To embed them:

```bash
docker compose exec backend npm run ai:reembed
```

The script iterates tenants, then products in batches, and writes
the embedding back through `$executeRaw`. It is **idempotent** —
running it twice produces the same end state — so it is safe to
re-run on partial failure. The HTTP endpoint
`POST /api/v1/ai/reembed` is a stub that returns immediately with a
job ID; the CLI is the only path that actually processes rows
(DEBT-037).

### 5b.5 Verifying it works

```bash
docker compose exec backend node -e "fetch('http://localhost:3001/api/v1/ai/status', { headers: { Authorization: 'Bearer ' + process.env.TOKEN } }).then(r => r.json()).then(console.log)"
```

A configured provider returns `{"configured": true, "provider":
"openai-compatible", ...}`. With no `AI_API_KEY` the same endpoint
returns `{"configured": false, "provider": null, ...}` and every AI
feature has fallen back to its non-AI path. `GET /api/v1/ai/stats`
reports the per-tenant embedding coverage so you can see the backfill
progress without running a query.

---

## 6. Operating the stack

- **Logs** — `docker compose logs -f backend` (or `frontend`). The
  backend writes structured JSON-ish lines; tail with `--tail=200` to
  catch the boot sequence.
- **Restart** — `docker compose restart backend` for config changes that
  don't require a rebuild (rate limits, CORS). For env changes, restart
  the affected service.
- **Update** — pull new code, then `./scripts/deploy.sh` (build →
  migrate once → up). Compose rolls the backend after the migration has
  already been applied; its healthcheck holds traffic away while the new
  container boots, and old containers finish in-flight requests. Do not
  use a bare `docker compose up -d` for a release that adds a migration:
  nothing applies it at container start any more (§3.2).
- **Backup** — Supabase provides automated daily backups on paid
  plans; for free-tier projects, configure
  [`supabase db dump`](https://supabase.com/docs/guides/cli/local-development#database-migrations)
  as a cron on the host.
- **Monitoring** — point your collector at `/api/v1/health/ready`. A
  200 is the canonical "healthy" signal; a 503 is a paging event.

---

## 7. Troubleshooting

### Backend exits immediately on start

Check the boot log (`docker compose logs backend`). Common causes:

- `Invalid environment configuration — refusing to start` — the
  validators in `env-validation.ts` caught a missing/placeholder
  secret. Fill in the real values.
- `P1001: Can't reach database server` — `DATABASE_URL` points
  somewhere unreachable. For Supabase, the most common cause is a
  password containing a URL-reserved character that needs
  percent-encoding, or the wrong host/port for the pooler you picked.
  Note that `?sslmode=require` is **not** the fix — it is rejected at
  startup (see below); Supabase mandates TLS server-side anyway.
- Errors about a missing column or table — the migration step was
  skipped. The backend no longer migrates on boot (§3.2). Run
  `docker compose --profile migrate run --rm migrate`, or redeploy with
  `./scripts/deploy.sh`.
- `P3009` / drifted migration history from the **migrate** container — run
  `docker compose --profile migrate run --rm --entrypoint sh migrate -c
  "npx prisma migrate status --schema=prisma/schema.prisma"` to see the
  diff. Resolve locally and redeploy.

### Frontend returns 502 Bad Gateway

The frontend container is up but the standalone server has crashed or
is still booting. Check `docker compose logs frontend`. If the boot
fails with `Error: Cannot find module 'next'`, the build did not
produce a clean standalone output — rebuild the image.

### `cross-origin request blocked` in the browser console

`CORS_ORIGIN` does not match the origin the browser is using. The
allow-list is exact-match (no path, no wildcard) — `https://app.yourdomain.com`
and `https://www.yourdomain.com` are different origins and must both
be listed, comma-separated.

### Password reset email never arrives

`SMTP_HOST` is unset or the credentials are wrong. With SMTP unset,
the console stub logs a "would have sent" line on every reset request;
check the backend's stdout. With SMTP set but the email still missing,
the most common cause is the provider's outbound-IP allow-list or
SPF/DKIM record not yet propagated.

### pgvector missing on a fresh Supabase project

Supabase has pgvector available on all plans; it just needs enabling
per project. Run in the Supabase SQL editor:

```sql
create extension if not exists vector;
```

The 20260830000000_smart_search_pgvector migration is the first one
that needs it — a fresh project will fail on that one until the
extension is created.

### `self-signed certificate in certificate chain` on the Supabase direct connection

Supabase's Postgres serves a cert chained to a **private root CA**
(`Supabase Root 2021 CA`) that Node's bundled CA store does not trust.
The TLS handshake starts fine, but `node-postgres` refuses the chain.

Fix: download the CA cert from the Supabase dashboard
(*Project Settings → Database → Connection string → SSL Certificate →
Download*), save it as `backend/supabase-ca.crt`, and bring the stack up
with the Supabase overlay, which mounts it at `/etc/mbos/supabase-ca.crt`
and sets `DATABASE_CA_CERT_PATH`:

```bash
docker compose -f docker-compose.yml -f docker-compose.supabase.yml up -d
```

The root cert alone is enough — the server presents its intermediate
during the handshake, so there is no need to concatenate a bundle. The
same file works from the host when running the seed or migrations
locally; point `DATABASE_CA_CERT_PATH` in `backend/.env` at its absolute
path.

The cert is **required** for Supabase, not a nicety. Without it the
connection is refused outright (`XX000 SSL connection is required for
user: postgres`) — there is no working fallback to the bundled CA store.
And if `DATABASE_CA_CERT_PATH` is set but unreadable, the backend
deliberately refuses to boot rather than downgrade to an unverified
connection; the startup error names the path.

Stock Postgres, the `local-db` profile, and providers whose certs chain
to a publicly-trusted root need none of this: use the base compose file
on its own and leave `DATABASE_CA_CERT_PATH` unset.

### `DATABASE_URL contains an sslmode parameter` at startup

Deliberate guard, not a bug. `pg-connection-string` turns any
`?sslmode=...` into its own `ssl` object which **replaces** the pinned
CA, reintroducing the `self-signed certificate` failure above. TLS is
mandatory on Supabase's side regardless, so the parameter only does
harm. Remove it from `DATABASE_URL`.

### Migrations succeed but do not verify the Supabase CA

Worth knowing if you are reasoning about the trust boundary:
`prisma migrate deploy` connects over TLS but does **not** verify the
server chain against your pinned root. Prisma 7's schema engine ignores
`PGSSLROOTCERT` and the URL's `sslrootcert` — migrations succeed with the
variable unset, with a bogus path, and even with
`sslmode=verify-full&sslrootcert=<bogus>`. The application's own runtime
pool (`PrismaService`) *does* verify, so this is scoped exclusively to the
migration tool's connection.

This is a known upstream limitation with no connection-string fix
(prisma/prisma#10833, closed as not planned). It is **partially
mitigated**: since migrations were moved out of container start (§3.2),
the unverified connection happens once per deploy from the host running
`scripts/deploy.sh`, rather than continuously from every replica's boot.
The residual risk — an active MITM on that one deploy-time connection
could capture the database credentials — is accepted and recorded in
DEBT-040; full closure via a verifying local tunnel is scheduled for the
production-hardening phase.

### Backend healthcheck flapping (passes then fails then passes)

A liveness check that touches the database will flap on every Postgres
hiccup. The configured healthcheck is the **readiness** probe
(`/api/v1/health/ready`) which is the right call — but make sure your
orchestrator's restart policy gates on a sustained failure (three
consecutive failures, not one). Compose's default
`retries: 3, interval: 15s` is the right shape.

---

## 8. What this document does not cover

- **CI** — the GitHub Actions pipeline lives at
  `.github/workflows/ci.yml` (committed in a separate slice).
- **Migration to multi-instance** — for a single container the
  defaults here are right. Multi-instance requires a shared cache
  handler (Redis) and a stable `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`
  across instances; the Next 16 self-hosting doc
  (`node_modules/next/dist/docs/01-app/02-guides/self-hosting.md`)
  is the reference.
- **CDN / DDoS protection** — out of scope for the container. Cloudflare
  in front of Caddy is the recommended addition for production traffic.
- **Database HA** — Supabase's point-in-time recovery and read replicas
  are configured in the Supabase dashboard, not here.
