# MBOS

A multi-tenant ERP for small and mid-sized businesses, built against the
specs in `docs/`. Two applications, one repo:

| App        | Stack                                       | Path      | Port (dev) |
| ---------- | ------------------------------------------- | --------- | ---------- |
| Frontend   | Next.js 16 (App Router) + React 19          | `.`       | 3000       |
| Backend    | NestJS 11 + Prisma 7 (PostgreSQL 17 + pgvector) | `backend/` | 3001       |

The frontend is the user-facing app; the backend is a single REST API
mounted at `/api/v1`. Authentication is bearer-JWT-in-memory with the
refresh token as an `httpOnly` cookie. The spec is the source of truth
for behaviour — `docs/section-1..6` cover business foundation through
API design.

---

## Quick start (development)

You need Node 22 and PostgreSQL 17 (with the `vector` extension; the
[pgvector/pgvector:pg17](https://hub.docker.com/r/pgvector/pgvector)
Docker image is the easiest source). Supabase also works as a managed
option — set `DATABASE_URL` in `backend/.env` to your Supabase direct
connection string.

```bash
# 1. Backend
cd backend
cp .env.example .env
# fill in DATABASE_URL, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET
npm install
npx prisma migrate deploy
npx prisma generate
npm run db:seed
npm run start:dev

# 2. Frontend (in a new terminal, at the repo root)
cp .env.example .env.local
# NEXT_PUBLIC_API_URL=http://localhost:3001
npm install
npm run dev
```

Open <http://localhost:3000>. The seed creates a dev tenant with the
user `owner@dev.local` (the password is in `backend/src/prisma/seed.ts`
and is dev-only — the seed refuses to run it when
`NODE_ENV=production`).

---

## Production

The full deployment runbook is in [`docs/deployment.md`](docs/deployment.md).
The short version:

```bash
cp .env.production.example .env.production
# fill in secrets, Supabase URL, CORS_ORIGIN, NEXT_PUBLIC_API_URL
./scripts/deploy.sh
```

`scripts/deploy.sh` is the whole release: it builds the images, applies
migrations **once** in a throwaway container, and only then starts the
services. The equivalent by hand is:

```bash
docker compose build
docker compose --profile migrate run --rm migrate   # required, not optional
docker compose up -d
```

On Supabase, first download the project's CA cert to
`backend/supabase-ca.crt` and add the overlay that mounts it — the
connection is refused without a pinned root. Put

```bash
COMPOSE_FILE=docker-compose.yml:docker-compose.supabase.yml
```

in a root `.env` (compose reads that file for its own configuration) so
every `docker compose` invocation — including the ones inside
`scripts/deploy.sh` — picks the overlay up. Passing `-f docker-compose.yml
-f docker-compose.supabase.yml` by hand works too, but then you must pass
it to the migrate step as well as `up`. Details:
[docs/supabase-setup.md](docs/supabase-setup.md).

The backend container does **not** migrate on boot — the `migrate` step
above is the only thing that applies migrations, so it has to run before
`up` on every release that adds one. That is deliberate: Prisma's schema
engine does not verify the database's certificate chain (DEBT-040), and
migrating from every container start of every replica both widened that
exposure and had N replicas racing on DDL. The frontend's
`NEXT_PUBLIC_API_URL` is baked in at build time, so change it in
`.env.production` **before** the build.

---

## Repository layout

```
.
├── src/                       # Next.js frontend (App Router)
│   ├── app/                   # Routes
│   ├── components/            # shadcn/ui + feature components
│   ├── lib/api/               # Typed client for the backend API
│   └── contexts/              # Session + tenant contexts
├── backend/
│   ├── src/
│   │   ├── ai/                # AIProviderInterface + Smart Search + Insights (NFR-11)
│   │   ├── auth/              # JWT + refresh + password reset
│   │   ├── common/            # Pipes, filters, guards, decorators
│   │   ├── config/            # env-validation
│   │   ├── mail/              # MAIL_PROVIDER seam (console + SMTP)
│   │   ├── prisma/            # PrismaService + tenant-scoping extension
│   │   ├── products/          # Products + embedding hooks
│   │   ├── reports/           # Section 6.11
│   │   ├── tenancy/           # Tenant context
│   │   ├── ai/                # Smart Search + Dashboard Insights (Phase 1)
│   │   └── ...                # one folder per module
│   ├── prisma/                # schema.prisma + migrations
│   └── test/                  # e2e (Jest + Supertest)
├── docs/                      # Section 1–6 specs + deployment.md
├── DOCUMENTATION_DEBT.md      # Open questions and deferred work
├── docker-compose.yml         # backend + frontend (+ optional local-db)
├── Dockerfile                 # Frontend (Next 16 standalone)
└── .env.production.example    # Documented production env vars
```

---

## Documentation

- **Spec** — `docs/section-1-business-foundation.md` through
  `docs/section-6-api-design.md`.
- **Deployment** — [`docs/deployment.md`](docs/deployment.md).
- **Open debt** — [`DOCUMENTATION_DEBT.md`](DOCUMENTATION_DEBT.md). Every
  known gap, with a why and a how-to-resolve.

---

## Running the tests

Two suites, deliberately separated by what they need:

```bash
cd backend

# Unit tests. No database, no network, ~15s.
npm test

# E2E tests. Needs Docker: brings up a throwaway pgvector Postgres,
# migrates, seeds, runs, tears it down.
npm run test:e2e:local
```

`npm test` collects `src/**/*.spec.ts` but excludes `*.e2e.spec.ts`. The
e2e suites boot the full `AppModule` and write real rows, so they run
only under `npm run test:e2e` against a disposable database
(`docker-compose.test.yml`, pgvector on `127.0.0.1:55432` — a distinctive
port so it cannot be confused with a local dev Postgres on 5432).

Two guards make that separation enforced rather than conventional, and
both fail loudly:

- **`backend/test/guard-database.ts`** refuses to run any e2e test unless
  `DATABASE_URL` resolves to a recognised throwaway host. A Supabase host
  is refused unconditionally and cannot be overridden. This exists because
  the e2e suites previously ran against the live Supabase project on every
  `npm test`; they clean up in `afterAll`, but an interrupted run does not.
- **`backend/src/config/test-environment.ts`** forces the no-op
  `AIProviderInterface` binding whenever `JEST_WORKER_ID`, `NODE_ENV=test`
  or `TEST_MODE=true` is present, reading `process.env` directly so no
  config mock or `.env` value can defeat it. Before this, a real
  `AI_API_KEY` in `backend/.env` meant `npm test` sent ~75 embedding
  requests to a live, paid OpenAI account.

Neither guard depends on anyone remembering to unset a variable. CI runs
both suites on every PR, and the e2e job deliberately sets a sentinel
`AI_API_KEY` so a regression in the provider guard fails the build.

---

## Conventions

- **No provider-specific SDKs in the application code.** The AI
  integration goes through `AIProviderInterface`; the mail integration
  goes through `MAIL_PROVIDER`. Adding a new provider means writing one
  implementation file, never touching feature code.
- **Money is integer minor units.** `*Cents` columns; never float
  (DEBT-012).
- **Tenant scoping is at the data layer.** A Prisma client extension
  filters every `find*` / `count*` / `aggregate*` call on `tenantId`
  from the request context. Raw `$queryRaw` calls must take `tenantId`
  as an explicit bind parameter — the extension does not wrap raw SQL.
- **Branch-per-feature.** Commits on a feature branch; the slice
  granularity matches the task granularity (one backend hardening, one
  frontend hardening, one Docker packaging, one CI, etc).

---

## Status

- ✅ Spec sections 1–6 implemented end-to-end
- ✅ Backend hardening: health, graceful shutdown, password reset (SMTP),
  seed gating, env validation
- ✅ Frontend hardening: auth pages wired, mocks removed, error
  boundaries, standalone output
- ✅ AI Phase 1: provider-agnostic interface, Smart Search, Dashboard
  Insights (no provider required to use the app)
- ✅ Docker packaging: multi-stage images, compose, Supabase or local-db
- ⬜ CI: GitHub Actions pipeline (in progress)
- ⬜ TLS / CDN: deployment responsibility, not application
