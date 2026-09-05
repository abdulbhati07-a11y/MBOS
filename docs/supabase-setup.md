# Supabase one-time setup

Two manual actions in the Supabase dashboard before the backend can talk
to the project. Do these in this order — the cert is required for the TLS
handshake; pgvector is required by the
`20260830000000_smart_search_pgvector` migration.

Both are per-project and only need doing once.

## 1. Download the CA cert

Supabase serves a certificate chained to a **private root**
(`Supabase Root 2021 CA`). Node's bundled CA store does not trust it, so
the handshake fails with `self-signed certificate in certificate chain`
until that root is pinned. Leaving it out is not an option: Supabase also
refuses unencrypted sessions (`XX000 SSL connection is required for user:
postgres`).

Steps in the Supabase dashboard:

1. Open your project's dashboard.
2. Left sidebar → **Project Settings** (gear icon at the bottom)
3. **Database** in the left panel of settings
4. Scroll to **Connection string** → **SSL Certificate**
5. Click **Download**
6. The file may be named `supabase-ca.crt` or `prod-ca-2021.crt` — either
   is fine, the content is the same root.

Save it as **`backend/supabase-ca.crt`**. The root on its own is
sufficient; the server presents its intermediate during the handshake, so
there is no need to concatenate a bundle.

Certs are gitignored (`*.crt`) so each deployment downloads its own
rather than inheriting a committed one that will go stale.

Then wire the path in:

- **Local (host)** — in `backend/.env`, set both to the file's absolute
  path:

  ```
  DATABASE_CA_CERT_PATH="/absolute/path/to/backend/supabase-ca.crt"
  PGSSLROOTCERT="/absolute/path/to/backend/supabase-ca.crt"
  ```

- **Docker** — add the overlay that mounts the cert and sets the vars for
  you:

  ```bash
  docker compose -f docker-compose.yml -f docker-compose.supabase.yml up -d
  ```

  See [deployment.md §3.0](./deployment.md) for making that the default
  via `COMPOSE_FILE`.

`DATABASE_CA_CERT_PATH` is read once at boot by `buildPgConfig`
(`backend/src/prisma/pg-config.ts`) and pinned as the connection's only
trust anchor, with `rejectUnauthorized` on. A missing or unreadable file
is a fatal startup error by design — a silent downgrade to an unverified
connection would be worse than a failed boot.

`PGSSLROOTCERT` is libpq's standard variable, honoured by `psql`,
`pg_dump` and friends. Prisma 7's schema engine does **not** read it, so
`prisma migrate deploy` connects over TLS without verifying the chain
(DEBT-040 — upstream limitation, no connection-string fix). Set it anyway:
it is correct for the CLI tools in the same container. Migrations run once
per deploy from the one-shot `migrate` service, never from a container
boot, which is what keeps that unverified connection to a single event.

Do **not** add `?sslmode=...` to `DATABASE_URL`. `pg-connection-string`
turns it into an `ssl` object that replaces the pinned CA, which puts the
`self-signed certificate` error straight back. `buildPgConfig` rejects
such a URL at startup.

## 2. Enable pgvector

1. Left sidebar → **SQL Editor**
2. **+ New query**
3. Paste:

   ```sql
   create extension if not exists vector;
   ```

4. **Run** (Ctrl+Enter)

The response should be `Success. No rows returned`. `extension "vector"
already exists` is equally fine — the statement is idempotent.

## 3. Verify

```bash
# Cert present where the config points?
ls -l backend/supabase-ca.crt

# It should be the Supabase root, and unexpired:
openssl x509 -in backend/supabase-ca.crt -noout -subject -enddate

# Schema reachable and up to date? (run from backend/)
npx prisma migrate status
```

pgvector, from the same SQL editor:

```sql
select extname, extversion from pg_extension where extname = 'vector';
```

Once migrations report up to date, seed with `npm run db:seed` from
`backend/`.
