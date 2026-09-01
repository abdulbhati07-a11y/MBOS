# Deployment

> **Document status:** Runbook. Reflects the Docker packaging in the repo
> root (`Dockerfile`, `docker-compose.yml`, `.env.production.example`,
> `backend/Dockerfile`, `backend/docker-entrypoint.sh`). Cross-references
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

```bash
# Build images. The frontend build bakes NEXT_PUBLIC_API_URL into the
# bundle — make sure .env.production has the right value before this.
docker compose build

# Bring the stack up. The backend's entrypoint runs `prisma migrate deploy`
# on every start; the first start applies all migrations to the
# (already-existing) Supabase project.
docker compose up -d

# Watch the backend boot — the migrate output is the first thing logged.
docker compose logs -f backend
```

A successful first boot ends with `[entrypoint] starting API…` and the
`backend` service reporting `healthy` in `docker compose ps`.

### 3.1 One-shot migration (alternative)

If you want to apply migrations without restarting the API, use the
`migrate` profile:

```bash
docker compose --profile migrate run --rm migrate
```

This runs `prisma migrate deploy` against the database pointed at by
`DATABASE_URL` and exits. The backend service is not started.

### 3.2 Local development (no Supabase)

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

## 6. Operating the stack

- **Logs** — `docker compose logs -f backend` (or `frontend`). The
  backend writes structured JSON-ish lines; tail with `--tail=200` to
  catch the boot sequence.
- **Restart** — `docker compose restart backend` for config changes that
  don't require a rebuild (rate limits, CORS). For env changes, restart
  the affected service.
- **Update** — pull new code, `docker compose build`, `docker compose
  up -d`. Compose rolls the backend first; its healthcheck holds
  traffic away while the new container boots. Migrations are part of
  the backend's entrypoint, so a deploy with a new migration just
  works — old containers finish in-flight requests, the new one runs
  `migrate deploy`, then takes traffic.
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
  somewhere unreachable. For Supabase, the most common cause is
  forgetting `?sslmode=require` or the password containing a URL-
  reserved character that needs percent-encoding.
- `Prisma migration error` — the migration history has drifted from
  the schema. `docker compose exec backend npx prisma migrate status`
  reports the diff. Resolve locally and redeploy.

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
