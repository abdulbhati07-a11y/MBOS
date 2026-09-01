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
docker compose build
docker compose up -d
```

The backend entrypoint runs `prisma migrate deploy` on every start; the
first boot applies all migrations to your Supabase project. The
frontend's `NEXT_PUBLIC_API_URL` is baked in at build time, so change
it in `.env.production` **before** `docker compose build`.

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
