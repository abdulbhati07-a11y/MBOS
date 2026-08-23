# Documentation Debt

Running list of business rules, constraints, and design decisions that originated in code during the UI build phase and have not yet been written into the formal requirements/design documents. Each item must be resolved before the corresponding section of the SRS/design doc is finalized.

---

## How to use this file

Each entry has:
- **Where it needs to land** — the SRS section or design document that must be updated
- **What needs to be written** — the actual rule or decision, not a pointer to code
- **Source** — where the current best description lives (code file + comment, or step close)
- **Status** — Open / Resolved (with PR/commit reference when resolved)

---

## Open Items

---

### DEBT-001 — Password complexity rules not in SRS

**Where it needs to land:** Section 3 (Authentication & Security), FR-AUTH-* password validation requirements

**What needs to be written:** The exact password policy enforced by `passwordSchema` in `src/lib/validation/auth.ts`. Currently this schema defines the real constraints (minimum length, character classes, etc.) but Section 3 of the SRS does not enumerate them. Anyone writing the API's auth layer or a password-strength UI without reading the frontend validation code would not know the correct rules.

**Source:** `src/lib/validation/auth.ts` — the `passwordSchema` definition. Identified during Step 4 review.

**Status:** Open

---

### DEBT-002 — PO status lifecycle not in SRS

**Where it needs to land:** Section 2 FR-PUR-* (functional requirements for Purchase Orders) and Section 9 (Core Modules Part B — Purchases module spec)

**What needs to be written:** The full PO status state machine, including all states, all legal transitions, and both terminal states:

```
Draft     → Sent, Cancelled
Sent      → Received, Cancelled
Received  → (terminal)
Cancelled → (terminal)
```

Currently this only exists as `PO_TRANSITIONS` in `src/lib/mock-data/purchase-orders.ts`. The SRS has no formal state model for PO lifecycle.

**Additional requirement for Section 6 (API Design):** The API's PO status-update endpoint must validate transitions server-side against this same map. Client-side enforcement (`PO_TRANSITIONS`) is a UX affordance only — it is not a data-integrity guarantee. A caller hitting the API directly can currently skip any transition (e.g., Draft → Received) without going through the intermediate state.

**Source:** `src/lib/mock-data/purchase-orders.ts` — `PO_TRANSITIONS` constant and adjacent TODO comment. Identified during Step 7 review.

**Status:** Open

---

### DEBT-003 — Deactivated supplier name on existing POs (edit-PO feature constraint)

**Where it needs to land:** Section 9 (Purchases module spec), specifically the edit-PO feature when it is designed

**What needs to be written:** When an edit-PO screen is built, it must store and display the supplier name (and ideally supplier ID) as it existed at PO creation time, independent of the supplier's current `isActive` flag or any subsequent rename. The correct model is a snapshot of supplier identity on the PO record at creation, not a live FK lookup — this protects against both deactivation and rename scenarios.

Current state: `PurchaseOrderRecord.supplierName` is a stored string, so deactivation doesn't break display. This is accidentally correct, not structurally enforced. The comment in `PODetailDialog.tsx` documents the intended behavior but doesn't enforce it.

**Source:** `src/components/purchases/PODetailDialog.tsx` — inline comment. `src/lib/mock-data/purchase-orders.ts` — `supplierName: string` field. Identified during Step 7 review.

**Status:** Open — safe to leave as comment until edit-PO is designed; must become a structural constraint (tested, not just documented) at that point.

---

### DEBT-004 — Customer order history FK (partially resolved)

**Where it needs to land:** Section 8 (Core Modules Part A — Customers) and Section 6 (API Design, customer-order relationship)

**What needs to be written:** The API Orders schema must include `customerId` as a non-nullable FK to the Customers table. The backend must enforce referential integrity.

**Current state (resolved at mock-data layer):**
- `OrderRecord` now has `customerId: string | null`
- All seed `MOCK_ORDERS` have `customerId` populated (matching `CustomerRecord.id`)
- `getCustomerStats` and `CustomerDetailDialog` both filter by `customerId` — name-string collision risk eliminated for seed data
- `NewOrderForm` (POS) sets `customerId: null` on new orders — known, explicit limitation, not a silent wrong answer

**Remaining open item:** POS-created orders will not appear in any customer's order history until (1) `NewOrderForm` gains a `CustomerRecord` selector UI, and (2) the backend Orders API enforces `customerId` as required. Both are backend integration phase work.

**Source:** `src/lib/mock-data/orders.ts`, `src/lib/mock-data/customers.ts`, `src/components/customers/CustomerDetailDialog.tsx`, `src/components/sales/NewOrderForm.tsx`. Identified during Step 6 review; mock-data layer resolved after Step 7 close.

**Status:** Partially resolved — mock data layer fixed; POS customer-linking deferred to backend integration

---

### DEBT-005 — Supplier categories are free-text with no taxonomy enforcement

**Where it needs to land:** Section 9 (Purchases module spec) and Section 2 (Inventory module spec, product categories)

**What needs to be written:** Whether product categories and supplier categories should share a common taxonomy (enum or lookup table), and if so, what enforces that relationship. Currently `SupplierRecord.categories` is a free-text comma-separated string. Values happen to mirror `MOCK_PRODUCTS` category names by convention but there is no enforced relationship.

**Source:** `src/lib/mock-data/suppliers.ts` — categories field comment. Identified during Step 7 planning.

**Status:** Open

---

### DEBT-006 — RoleProvider is frontend-only, not backed by auth/session

**Where it needs to land:** Section 6 (API Design) and Section 7 (Auth/Session)

**What needs to be written:** The mechanism for deriving the current user's `Role` from the JWT/session token and injecting it into `RoleProvider` as `initialRole`. The context shape (`Role`, `canPerform(module, action)`) is already designed for this swap — consumers call `useCanPerform` and require no changes when the backing source changes from React state to real auth.

**Current state:** `RoleProvider` holds role in `React.useState`, defaulting to `"Manager"`. The AppShell header exposes a role-switcher dropdown for demo purposes. This is the correct shape but not real auth.

**What to do at Section 6/7 time:**
1. Remove the role-switcher dropdown from `AppShell` header
2. Pass the JWT-derived role into `RoleProvider` as `initialRole` (or connect it via a session context)
3. Remove the `setRole` export from `role-context.tsx` (no longer needed once role is read-only from auth)

**Source:** `src/contexts/role-context.tsx` — DEBT-006 comment. `src/components/shared/AppShell.tsx` — role switcher TODO comment. Introduced in Step 9.

**Status:** Open

---

### DEBT-007 — FR-SET-02 custom roles require type system changes

**Where it needs to land:** Section 2 FR-SET-02, Section 6 (API Design — roles/permissions endpoints), Section 9 (Settings module spec)

**What needs to be written:** Custom role support is not purely a UI task. The current `Role` type is `"Owner" | "Manager" | "Cashier"` — a closed union. `PermissionMatrix` is keyed on this type, and `canPerform` looks up `DEFAULT_ROLE_PERMISSIONS` which is a static constant. Supporting tenant-defined roles requires:
1. Widening `Role` to `string` (losing compile-time exhaustiveness on the matrix) OR introducing a parallel runtime registry alongside the static defaults
2. Updating `canPerform` to look up a dynamic store (API-backed) rather than the static constant
3. A backend roles/permissions API with tenant scoping
4. UI for creating, editing, and deleting custom roles (FR-SET-02)

None of these are UI-only changes. The permission matrix UI built in Step 10 is explicitly read-only and displays the three fixed roles only.

**Source:** `src/config/permissions.ts` — `Role` type definition and `DEFAULT_ROLE_PERMISSIONS`. `src/components/settings/PermissionMatrixTable.tsx` — read-only notice. Introduced in Step 10.

**Status:** Open — out of scope until backend auth/roles API is designed (Section 6)

---

### DEBT-008 — Company profile default tax rate not wired to POS

**Where it needs to land:** Section 8 (Sales module spec) and Section 9 (Settings module spec) — the relationship between a company-level default tax rate and the per-order tax rate in the POS

**What needs to be written:** When the Settings API exists, the default tax rate configured in Company Profile should pre-populate `NewOrderForm`'s tax rate field. Currently `NewOrderForm` hardcodes `taxRate: 0` as its default. The Company Profile form in Settings stores its value in local React state only — there is no cross-component wiring.

**Source:** `src/components/settings/CompanyProfileForm.tsx` — DEBT-008 comment on the save handler. `src/components/sales/NewOrderForm.tsx` — `defaultValues.taxRate: 0`. Introduced in Step 10.

**Status:** Open — requires a settings context or API; deferred to backend integration phase

---

### DEBT-009 — Reports export (PDF/CSV) not implemented

**Where it needs to land:** Section 2 FR-REP-03 (exportable reports)

**What needs to be written:** Export format requirements, what data each report exports, and whether export is server-side rendered (PDF generation) or client-side (CSV serialisation). A library decision is also needed (e.g., `react-pdf`, `papaparse` for CSV, or a backend-generated export endpoint).

**Current state:** No export library is wired. Export actions are not present in the Reports UI. The tab layout and data are all in place — adding export is additive once a library is chosen.

**Source:** `src/app/(dashboard)/reports/page.tsx` — FR-REP-03 comment. Introduced in Step 12.

**Status:** Open — deferred until export library and format requirements are decided

---

### DEBT-010 — Customer/Supplier ledger requires backend financial data model

**Where it needs to land:** Section 8 (Customers module spec) and Section 9 (Purchases/Suppliers module spec), plus Section 6 (API Design — financial ledger schema)

**What needs to be written:** The financial ledger concept: invoice records, payment records, outstanding balances, credit terms, aging buckets. None of these fields exist on `CustomerRecord` or `SupplierRecord`. The Reports "Customer & Supplier Activity" tab shows spend summaries (total orders, total PO value) — this is the maximum achievable from current data without fabricating fields.

A true ledger requires: `Invoice`, `Payment`, and `Balance` entities in the backend schema, linked to Customer/Supplier by FK. The frontend reports can then be extended once these exist.

**Source:** `src/app/(dashboard)/reports/page.tsx` — ActivityTab disclaimer note. `src/lib/mock-data/customers.ts` and `src/lib/mock-data/suppliers.ts` — absence of balance/invoice fields. Identified during Step 12 data availability review.

**Status:** Open — blocked on backend financial data model design

---

### DEBT-011 — MOCK_ORDERS is static; session-placed orders not reflected in Reports/Dashboard

**Where it needs to land:** Section 6 (API Design — orders endpoint) and the frontend `use-dashboard-metrics` hook and Reports page

**What needs to be written:** An `OrdersContext` analogous to `ProductsContext` (Step 11) should hold the live orders array and be written to by `SalesPage` when `NewOrderForm` places an order. Currently, `SalesPage` holds orders in local `useState` — orders placed during a session are invisible to Reports, Dashboard's Recent Orders widget, and `getCustomerStats`.

**Impact today:** Reports Sales Summary and Dashboard Recent Orders both show only the 5 seed orders. An order placed via the POS during a session disappears from both views if the user navigates away from Sales.

**Fix:** Same pattern as `ProductsContext` — lift `MOCK_ORDERS` into `OrdersContext`, wrap the dashboard layout, wire `SalesPage` to write new orders to it, wire Reports and `use-dashboard-metrics` to read from it.

**Source:** `src/app/(dashboard)/reports/page.tsx` — DEBT-011 comment. `src/hooks/use-dashboard-metrics.ts` — reads `MOCK_ORDERS` directly. `src/app/(dashboard)/sales/page.tsx` — local `useState` for orders. Identified during Step 12 data availability review.

**Status:** Resolved — OrdersContext added; SalesPage, use-dashboard-metrics, Reports, customers/page.tsx, and CustomerDetailDialog all read from live shared state. getCustomerStats() removed entirely (was the last static MOCK_ORDERS consumer outside mock-data/). Commits d92e4c3 and e44a911.

---

### DEBT-012 — Frontend mock data uses float monetary values; backend must store as integer cents

**Where it needs to land:** Section 4.6 (Financial Calculation Rules), Section 5 (ERD — all monetary columns must be `INTEGER` not `DECIMAL`/`FLOAT`), Section 6 (API Design — all monetary fields in request/response bodies must be integers in cents)

**What needs to be written:** The architectural rule that all monetary values are stored as integers (cents/minor currency units) in the database and transmitted as integers in the API. The frontend's `toFixed(2)` display pattern is correct for presentation but is currently applied to JavaScript float values (e.g. `29.99`), not to integers divided by 100.

**Current state:** Every monetary field in the frontend mock data (`price`, `cost`, `total`, `subtotal`, `taxAmount`, `unitPrice`, `unitCost`, `lineTotal`) is a JavaScript `number` typed as a float. When the real API is connected, all these values must become integers in cents (`price: 2999`, `taxAmount: 425`), and the presentation layer must divide by 100 before calling `toFixed(2)`.

**Impact:** All mock-data files will need updating at API integration time. All `toFixed(2)` call sites must change to `(value / 100).toFixed(2)`. Systematic, mechanical — not a design decision — but touches every monetary display in every module.

**Source:** `src/lib/mock-data/orders.ts`, `src/lib/mock-data/products.ts`, `src/lib/mock-data/purchase-orders.ts` — all monetary fields. NFR-14 (fixed-point arithmetic requirement). Identified during Section 4 documentation review.

**Status:** Open — deferred to backend integration phase

---

### DEBT-013 — Rate limit thresholds unspecified

**Where it needs to land:** Section 2 NFR (rate limiting security requirement) and Section 6.1 (API Design — rate limiting subsection)

**What needs to be written (resolved):** The concrete thresholds, now decided:

- **Authenticated, per tenant:** 300 requests/minute, burst 50. Keyed on the JWT's `tenantId`, applied after authentication.
- **Auth endpoints, per IP:** 10 requests/minute, burst 3 — `POST /auth/login` and `POST /auth/mfa/verify`. This is the credential-stuffing ceiling and is deliberately the tightest limit in the system.
- **All other endpoints, per IP (pre-auth):** 120 requests/minute, burst 40 — the floor an unauthenticated caller hits before a tenant context exists.
- **Burst is additive, not multiplicative:** a "burst 50" allowance means 50 requests *on top of* the per-minute rate, so the effective ceilings are 350 (tenant), 13 (auth-IP) and 160 (global-IP). The `effectiveLimit(perMinute, burst) = ceil(perMinute + burst)` rule lives in `rate-limit.config.ts`.
- **`429` shape and `Retry-After`:** unchanged — they already matched Section 6.1 and are not affected by this resolution.

**Proxy trust (resolved):** Trust proxy headers **only from a pinned, known reverse-proxy IP range — never trust `X-Forwarded-For` unconditionally.** Configured by the `TRUST_PROXY` env var, read once in `main.ts` and passed to Express's `trust proxy` setting: unset/empty/`false` → trust nothing (use the socket address); an integer → trust exactly N hops; a comma-separated list → trust those specific proxy IPs/CIDRs. The literal `TRUST_PROXY='true'` is **refused at boot** (it would trust every hop and let any client forge `X-Forwarded-For` to evade the per-IP limit) — the app throws rather than start in that posture.

**Implementation:** `backend/src/rate-limit/rate-limit.config.ts` carries the resolved defaults (`RATE_LIMIT_DEFAULTS`) with the reasoning for each number; all six knobs remain overridable by env var (`RATE_LIMIT_AUTH_IP_PER_MINUTE`, `RATE_LIMIT_AUTH_IP_BURST`, `RATE_LIMIT_GLOBAL_IP_PER_MINUTE`, `RATE_LIMIT_GLOBAL_IP_BURST`, `RATE_LIMIT_TENANT_PER_MINUTE`, `RATE_LIMIT_TENANT_BURST`, documented in `backend/.env.example`), so any future change is configuration, not code. The four public `RateLimitConfig` fields the e2e specs override kept their names. The interim provisional-value language and the `×1.5 BURST_MULTIPLIER` were **removed, not left alongside** the resolved values.

**Source:** Section 6.1 rate-limiting subsection. Section 2 NFR list. `backend/src/rate-limit/rate-limit.config.ts`, `backend/src/main.ts` (`resolveTrustProxy`), `backend/.env.example`. Thresholds and proxy-trust posture resolved during the DEBT-013 close.

**Status:** Resolved — thresholds and proxy-trust setting decided and implemented; interim values replaced (not left alongside). Sections 6.1 and 2-NFR still need the prose updated to match these numbers, tracked as ordinary doc-sync, not an open decision.

---

### DEBT-014 — Login-time tenant resolution unspecified

**Where it needs to land:** Section 6.3 (POST /auth/login) and Section 5 (User uniqueness model)

**What needs to be written:** How the server decides *which tenant's* User record a login attempt is checked against. Section 6.3 says login "validates email and password against the current tenant's User record," but at login time no session — and therefore no tenant context — exists yet, and the platform defines no subdomain/Host-based tenant routing. Section 5 makes email unique per `(tenantId, email)`, **not** globally (`User @@unique([tenantId, email])`), so one email address may legitimately belong to several tenants. Nothing in Section 6.3 resolves that ambiguity. A decision is required between:
1. **Tenant carried on the request** — an explicit `tenantSlug`/`tenantId` in the login body, or one derived from a subdomain / `Host` header.
2. **Global email uniqueness** — change the Section 5 constraint to `email @unique` so an address maps to exactly one user.
3. **Return-and-choose** — respond with the list of tenants for that email and let the client pick, then re-submit.

**Decision (resolved — option 2, by way of D-01):** Tenant is resolved by **email lookup alone**. D-01 holds that one user belongs to exactly one tenant, so an email identifies its tenant without the caller naming one. There is no `tenantSlug` in the login request, no subdomain/`Host` routing, and no return-and-choose step; the login form is a plain email + password. The `(tenantId, email)` composite uniqueness in Section 5 is retained — D-01 is the operating rule, and the "exactly one candidate" guard below is what enforces it at the auth layer rather than a global `email @unique` constraint.

**Current state (implemented):** `LoginDto` is email + password only — the interim optional `tenantSlug` field and its comment are **removed**. `auth.service.ts#login()` queries `{ email, deletedAt: null, isActive: true }` on the unscoped client (no tenant context exists pre-auth). The `candidates.length !== 1` branch is kept as fail-closed defence: were `(tenantId, email)` uniqueness ever breached so one address spanned two tenants, login is refused (after a decoy bcrypt comparison) rather than signing the wrong tenant in. Zero and ambiguous both collapse to an identical generic `401`, so the response still cannot enumerate which emails or tenants exist.

**Source:** `backend/src/auth/dto/login.dto.ts`, `backend/src/auth/auth.service.ts` (`login()`, `candidates.length !== 1`), `backend/prisma/schema.prisma` (`User @@unique([tenantId, email])`). Resolved during the DEBT-014 close.

**Status:** Resolved — email-only tenant resolution implemented, interim `tenantSlug` removed. Section 6.3 still needs the prose updated to state "resolve the User by email; one user = one tenant (D-01)", tracked as ordinary doc-sync, not an open decision.

---

### DEBT-015 — Password reset endpoints specified but not implementable from the current schema

**Where it needs to land:** Section 6.3 (POST /auth/password/forgot, POST /auth/password/reset), Section 5 (ERD — a password-reset-token entity), Section 4 (external dependencies — transactional email)

**What needs to be written:** Two prerequisites the specified endpoints depend on but that no section defines:
1. **A reset-token entity.** Section 5's ERD has `RefreshToken` but nothing to persist a single-use, expiring password-reset token. `POST /auth/password/reset` ("consumes a reset token and sets a new password … existing refresh tokens for this user are revoked") cannot be built without one. Needs a `PasswordResetToken` model — `userId` FK, `tokenHash` unique, `expiresAt`, `usedAt` — stored hashed at rest, mirroring how `RefreshToken` keeps only a digest.
2. **A mail transport.** `POST /auth/password/forgot` "initiates email-based password reset," but no email/transactional-mail provider is chosen anywhere in Sections 4–6.

**Current state (schema + stub landed; transport still open):**
1. **Reset-token entity — done.** `PasswordResetToken` is now in `schema.prisma` — `id`, `userId` FK (`onDelete: Cascade`), `tokenHash @unique`, `expiresAt`, `usedAt DateTime?`, `createdAt`, `@@index([userId])` — with the matching `passwordResetTokens` back-relation on `User`. It is deliberately **not** tenant-scoped: reset begins from an email alone, before any tenant context exists, so it is looked up by `tokenHash` on the unscoped client, mirroring `RefreshToken` (hash at rest, never the raw token). Migration: `add_password_reset_token`.
2. **Mail transport — still undecided, stubbed behind an interface.** No provider is wired. `backend/src/mail/` defines a `MailProvider` interface with a single `sendPasswordReset(email, token)` method and a `MAIL_PROVIDER` Symbol injection token (a TS interface is not a runtime token). `ConsoleMailProvider` is a no-op implementation that logs that a reset *would* have been sent and to whom, but **never logs the token** (it is a live credential). `MailModule` is `@Global` and binds `MAIL_PROVIDER → ConsoleMailProvider`; selecting a real provider is a one-line `useClass` change with no caller edits. The `password/forgot` and `password/reset` endpoints themselves remain unbuilt — the stub is the seam they will plug into.

**To finalise the provider choice, three inputs are needed:**
- **Expected send volume** — password resets + any future transactional mail (invites, receipts), rough monthly ceiling. This separates "SMTP relay" from "managed API (SES/SendGrid/Postmark)" territory.
- **Budget ceiling** — a hard monthly cap, since managed providers price per-thousand above a free tier.
- **Existing provider account / infra constraint** — is there already an AWS account (→ SES is near-free and lowest-friction), a SendGrid/Postmark account, or a corporate SMTP relay that must be used? A regional/data-residency constraint on where mail metadata may leave from would also decide this.

**Source:** `docs/section-6-api-design.md` §6.3. `backend/prisma/schema.prisma` (`PasswordResetToken`). `backend/src/mail/mail.provider.ts`, `console-mail.provider.ts`, `mail.module.ts`. Section 4 external-dependencies (mail transport). Schema + stub added during the DEBT-015 close.

**Status:** Partially resolved — `PasswordResetToken` model added and the mail seam stubbed behind `MAIL_PROVIDER`; blocked only on the Section 4 transport decision (see the three inputs above) before `password/forgot`/`password/reset` can be built. Related: [DEBT-001].

---

### DEBT-016 — Module-key taxonomy diverges across layers

**Where it needs to land:** Section 5.3 (`RolePermission.module`, `TenantModuleSubscription.moduleKey`) and Section 6.2 (which module each endpoint group belongs to)

**What needs to be written:** One canonical list of module keys, and where it lives.

Section 5.3 states that `module` values "match the `Modules` and `Actions` TypeScript enums exactly", and Section 4 (lines 158–173) states that the frontend's `DEFAULT_ROLE_PERMISSIONS` *becomes* the `RolePermission` seed data, the TypeScript constant being "the frontend's optimistic cache of this data". That makes `src/config/permissions.ts` canonical. Three problems follow:

1. **`billing` exists only on the backend.** Section 6.10 defines billing endpoints, so the API needs a `billing` module key, but the frontend `Modules` enum has no `BILLING` member. The backend now grants `billing` to Owner only — an **inference**, not a documented rule: Section 6.10 states no required permission for its endpoints, and the canonical matrix has no `billing` row to copy. This needs confirming.

   **Update (Section 6.10 implemented):** the inference turns out to be moot, and the problem is worse than "unconfirmed". Section 6.10 gates its endpoints on `settings.read`/`settings.write`, so the `billing` key gates nothing at all — no route in the application requires a `billing` subscription or a `billing` permission. Either the billing endpoints should require `billing.*`, or the key should be removed from the taxonomy. See DEBT-018.
2. **The backend was missing four keys the frontend has.** `dashboard`, `clinic`, `pharmacy` and `restaurant` were absent from the backend's module list, so under the fail-closed module check every endpoint in those modules would have returned `403`. Now added.
3. **The list is mirrored by hand in two files** — `src/config/permissions.ts` and `backend/src/access-control/access-control.constants.ts` — so it can drift again silently, which is exactly how the divergence below arose. It should be generated from one source, or a test should assert the two agree.

**Related — the divergence this replaced (resolved in code, still needs writing up):** before the Section 6.2 build, `backend/src/prisma/seed.ts` granted more than the canonical matrix — Manager had `settings.write` plus `delete` on inventory/customers/purchases; Cashier had `customers.write` and `reports.read`. That was inert while nothing read the table, but the permission guard makes `RolePermission` live authorization, so a Manager would have been able to create branches and custom roles (Section 6.4/6.5 gate those on `settings.write`) while the UI hid the controls. The seed now mirrors the canonical matrix cell-for-cell and *prunes* non-canonical rows for built-in roles; `access-control.e2e.spec.ts` asserts that Manager cannot write settings and Cashier cannot read reports, so it cannot silently regress.

**Decision (resolved) — Core vs Industry is the canonical taxonomy:**

Module keys fall into two classes, and *the class decides whether the key is ever a `TenantModuleSubscription` row*:

- **Core modules** — `dashboard`, `inventory`, `sales`, `customers`, `purchases`, `reports`, `settings`, `billing`. These are **not subscription-gated**. There is never a `TenantModuleSubscription` row for a core key; access is governed by RBAC (`RolePermission`) alone. Every tenant always has them.
- **Industry modules** — `clinic`, `pharmacy`, `restaurant`, and only these. They are **the only keys ever present in `TenantModuleSubscription`**. Access requires an enabled subscription row *and* the RBAC permission.

This resolves each of the three problems above:

1. **`billing` gates nothing — accepted, not a defect.** `billing` is a *core* key, so it was never meant to gate on a subscription; the Section 6.10 endpoints gating on `settings` is consistent with that (see DEBT-018 for the self-lockout guard, now subsumed by this rule). The `billing → Owner-only` RBAC grant stands as the intended rule, no longer an "inference to confirm".
2. **The four previously-missing keys are correct as core** (`dashboard`) **or industry** (`clinic`/`pharmacy`/`restaurant`); the fail-closed `403` risk is gone because the module-access guard now **short-circuits to allow for any non-industry key** and only consults `TenantModuleSubscription` for industry keys.
3. **Hand-mirroring is now caught, not merely deprecated.** Rather than a physical shared source (deferred — the two layers stay in their own files), `module-taxonomy.contract.spec.ts` asserts cell-for-cell that the backend `MODULE_KEYS`/`ROLE_MATRIX` and the frontend `Modules`/`DEFAULT_ROLE_PERMISSIONS` agree, with `billing` as the sole documented backend-only key. Drift now fails a test. The physical single-source refactor remains open as a lower-priority follow-up.

**Encoding:** `INDUSTRY_MODULE_KEYS = ['clinic','pharmacy','restaurant']` is the one explicit list in `access-control.constants.ts`; `CORE_MODULE_KEYS` is *derived* as `MODULE_KEYS \ INDUSTRY_MODULE_KEYS`, so any key added later defaults to core / always-available rather than silently becoming a `403`. `isIndustryModule()` is the single predicate the guard and `billing.service.ts` both call.

**Source:** `src/config/permissions.ts` (`Modules`, `DEFAULT_ROLE_PERMISSIONS`) vs `backend/src/access-control/access-control.constants.ts` (`MODULE_KEYS`, `INDUSTRY_MODULE_KEYS`, `CORE_MODULE_KEYS`, `ROLE_MATRIX`). `backend/src/access-control/module-access.guard.ts`, `module-taxonomy.contract.spec.ts`. `docs/section-5-database-design.md` line 146. `docs/section-4-system-architecture.md` lines 158–173. `docs/section-6-api-design.md` §6.10. Identified while implementing chain steps 5 and 6; taxonomy resolved during the DEBT-016 close.

**Status:** Resolved — Core vs Industry taxonomy decided; guard short-circuits core keys to allow, only industry keys hit `TenantModuleSubscription`, and a contract test locks the two layers together. Sections 5.3/6.2 still need the prose (doc-sync). Section 1.5.1's "pay only for what you use, incl. Sales/Inventory/POS" is contradicted by this decision — tracked as [DEBT-019]. Physical single-source refactor deferred. Related: [DEBT-007], [DEBT-018], [DEBT-019].

---

### DEBT-017 — Section 6.2 under-specifies two behaviours of the middleware chain

**Where it needs to land:** Section 6.2 (Middleware Chain), steps 2, 5 and 6

**What needs to be written:** Two decisions the implementation had to make that the chain description does not cover.

1. **What happens to an authenticated route that declares no module or action.** Section 6.2 says steps 5 and 6 read the requirement "from the route metadata" but never says what to do when there is none. Implemented **fail closed**: such a route returns `403`, on the reasoning that fail-open turns every forgotten decorator into an unguarded endpoint, whereas fail-closed turns the same mistake into a test failure. That required an explicit exemption, `@NoModuleRequired()`, for authenticated routes that legitimately belong to no business module — currently only `GET /auth/me`, which returns the caller's own identity and is what the frontend calls to discover its permissions, so gating it on a permission would be circular. Neither the default nor the exemption appears in the doc.

2. **Per-tenant rate limiting cannot precede authentication.** Section 6.2 places rate limiting at step 2, before auth at step 3, while Section 6.1 also requires a per-tenant limit keyed on the JWT's `tenantId` — which does not exist until step 3 has run. The two requirements are not simultaneously satisfiable. Implemented as a split: a per-IP limit before authentication (strict on the auth endpoints, which is where the unauthenticated flood risk actually is) and a per-tenant limit immediately after. The doc's step numbering should be amended to describe both halves.

**Also worth recording:** the chain's ordering is itself a security property — rate limiting must precede bcrypt work, and steps 5–6 depend on the context step 4 binds. The implementation therefore sequences all of it explicitly in one guard (`backend/src/common/guards/api-access.guard.ts`) rather than registering four global guards and depending on provider-resolution order. Section 6.2 describes the order but does not say it must be *guaranteed* rather than incidental.

**Source:** `docs/section-6-api-design.md` §6.2 lines 107–160 and §6.1 lines 82–104. `backend/src/common/guards/api-access.guard.ts`, `backend/src/access-control/access-control.decorators.ts`, `backend/src/rate-limit/rate-limit.guard.ts`. Identified while implementing chain steps 2, 5 and 6.

**Status:** Open — both behaviours implemented and commented in code; Section 6.2 needs amending so the contract is documented rather than inferred from the implementation.

---

### DEBT-018 — Module-subscription proration specified but not implementable; billing endpoints gate on `settings`

**Where it needs to land:** Section 6.10 (`PATCH /billing/modules`), Section 5 (per-module pricing and an invoice entity), Section 2 (the FR-BILL-02 requirement itself)

**What needs to be written:** Four things `PATCH /billing/modules` depends on that no section defines.

1. **FR-BILL-02 does not exist.** Section 6.10 says `effectiveDate` "is used to calculate proration per FR-BILL-02", but that identifier appears exactly once in the repository — in that sentence. There is no proration rule to implement: no statement of whether a mid-period enable is charged from the effective date or the period start, whether a disable refunds or credits, or how partial months round.
2. **No per-module price exists in the schema.** Section 6.10's example returns `proratedChargeCents: 1250` for enabling `clinic`, but `Plan` prices a whole plan (`priceMonthly`, `priceAnnual`) and `PlanModule` is `{planId, moduleKey}` with no price column. Nothing in Section 5 records what an individual module costs, so the figure cannot be derived from stored data at all.
3. **No invoice to apply a charge to.** The specified message says the charge "will be applied to your next invoice", but Section 6.13 explicitly places the financial ledger (Invoice, Payment, CreditNote) out of scope, deferred to Sections 8/9 (DEBT-010). Even a correctly computed charge would have nowhere to go.
4. **Where the pending change lives is unstated.** Section 6.10 requires a confirmation step before committing, but names no entity to hold an unconfirmed change.
5. **`TenantModuleSubscription` cannot express more than one subscription period.** It has a single `enabledAt`/`disabledAt` pair, and Section 5.3 defines enabling as exactly "sets `disabledAt = NULL` on an existing row" — so after a disable/re-enable cycle `enabledAt` still reports the *first* time the module was ever switched on, not the start of the current period. `GET /billing/modules` therefore returns an `enabledAt` a client would misread as "enabled since". The implementation follows Section 5.3 literally rather than quietly overwriting the column. Prorating a mid-period change needs the current period's start, so this is a second, independent reason the charge cannot be derived from this table; a `TenantModuleSubscriptionPeriod` history (or an `enabledAt` that is documented as re-stamped) would fix it.

**Current state (implemented):** The endpoint is built and the UC-04 path works — a module toggled through it is reachable or refused on the very next request, with no restart, which `billing.controller.spec.ts` proves end to end. The parts that could be built honestly were:
- The two-step confirm gate is **kept** even with nothing to preview, because it still prevents an accidental toggle from silently changing what an entire tenant can reach.
- `proratedChargeCents` returns **`null`**, never a fabricated number, and is typed `number | null` so it can start carrying a real value without a breaking change. The message says plainly that no billing preview is available.
- The pending change is **not stored**: the client re-sends the same body with `confirmed: true`. A stateless recompute needs no new entity and cannot go stale.
- A `committed: boolean` field was **added** to the response, which Section 6.10's example does not have, so a client can distinguish a preview from an applied change without parsing prose.

**The gating and core-module questions — resolved by DEBT-016; proration still blocked:**

Section 6.10 states its endpoints require `settings.write` / `settings.read`, implemented verbatim. DEBT-016's Core vs Industry decision resolves the two questions this raised:
- The **`billing` key gating nothing is correct, not a defect.** `billing` is a *core* module (DEBT-016), so it was never meant to gate on a subscription; gating the endpoints on `settings` is consistent. The key is not dropped and does not need `billing.*` gating.
- **The core / un-cancellable list is now exactly the Core group, and derived, not inferred.** `billing.service.ts` no longer carries a hand-picked `NON_DISABLEABLE_MODULES` triple; it calls `isIndustryModule(dto.moduleKey)` and **refuses any core key** as an enable *or* disable target with `409` — core modules are never `TenantModuleSubscription` rows at all. Only the three industry keys can be toggled. This both closes the self-lockout hole (you cannot disable `settings`, `billing`, or `dashboard` because they are core) and removes the "inferring the list in `billing.service.ts`" objection: the list is the derived `CORE_MODULE_KEYS`, sourced from the taxonomy, not a local constant. `billing.service.spec.ts` proves both the enable-core and disable-core refusals.

**Still blocked (proration only):** points 1–5 above — FR-BILL-02 not existing, no per-module price column, no invoice entity, no store for a pending change, and `TenantModuleSubscription`'s single `enabledAt`/`disabledAt` pair being unable to express more than one period — are **unchanged**. `proratedChargeCents` still returns `null` (never a fabricated number) and the confirm gate is still kept. Proration cannot be built until those Section 2/5/8-9 gaps are filled.

**Source:** `docs/section-6-api-design.md` §6.10 lines 560–609 (proration, `settings.write` gating, the "re-POST" wording against a `PATCH` route) and §6.13 line 713. `backend/prisma/schema.prisma` — `Plan`, `PlanModule`, absence of any module price. `backend/src/billing/billing.service.ts` — `isIndustryModule()` core-key refusal, the null proration, the confirm gate. `billing.service.spec.ts`. Identified while implementing Section 6.10; core-list and gating resolved via DEBT-016.

**Status:** Partially resolved — the toggle and all three read endpoints are implemented and tested; the `settings`-vs-`billing` gating and the core/un-cancellable list are **resolved** (core = never subscription-gated, only industry keys toggle; see DEBT-016). Proration remains **blocked** on a Section 2 requirement (FR-BILL-02), a Section 5 pricing column, and a Section 8/9 invoice entity. Related: [DEBT-010], [DEBT-016].

---

### DEBT-019 — Section 1.5.1 pricing narrative ("pay only for what you use") contradicts the Core/Industry model

**Where it needs to land:** Section 1.5.1 (Business Foundation — pricing/packaging narrative), and any onboarding/marketing copy derived from it

**What needs to be written:** Section 1.5.1 describes the pricing model as "pay only for what you use, **including Sales/Inventory/POS**." The DEBT-016 Core vs Industry decision **supersedes** that: Sales, Inventory, and the POS (part of Sales) are **core** modules — always available to every tenant, never a `TenantModuleSubscription` row, never toggled or separately billed. Only the **industry** modules (`clinic`, `pharmacy`, `restaurant`) are opt-in / per-use. So the "including Sales/Inventory/POS" clause is no longer true: those are baseline, not metered.

Either the copy must change (baseline platform fee covering all core modules + per-module add-ons for industry modules), or — if "pay only for what you use" down to Sales/Inventory is a genuine product requirement — DEBT-016 must be reopened and those keys reclassified as gateable. The engineering decision (DEBT-016) currently wins; this item records that the business-foundation narrative has to be reconciled to it, not the other way around, unless product says otherwise.

**Blocked on:** Sections 1–3 are not yet committed to the repo (see the pending "commit Sections 1–3" task), so this cannot be edited in place yet — the fix lands when Section 1.5.1 is brought into `docs/`.

**Source:** Section 1.5.1 pricing narrative (as quoted in the backend status-sync directive). `backend/src/access-control/access-control.constants.ts` (`CORE_MODULE_KEYS`, `INDUSTRY_MODULE_KEYS`). Raised by the DEBT-016 close. Related: [DEBT-016], [DEBT-018].

**Status:** Open — documentation/product-narrative reconciliation; the code model (Core never gated) is settled, Section 1.5.1 copy is what must move. Blocked on Sections 1–3 landing in the repo.

---

*(None yet — items move here when the corresponding SRS section is written and reviewed.)*
