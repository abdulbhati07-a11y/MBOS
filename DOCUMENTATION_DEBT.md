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

**Resolved by:** `docs/section-3-users-use-cases.md` §3.3.1, which enumerates the five constraints exactly as the schema enforces them (≥8 chars; ≥1 lowercase; ≥1 uppercase; ≥1 digit; ≥1 non-alphanumeric). It additionally records two things the original entry did not ask for but which an implementer needs:

1. **What is deliberately absent** — no maximum length, no character denylist, no dictionary or breach check, no rotation or history requirement. Documented so their absence reads as a decision rather than an omission.
2. **The enforce-on-set/never-on-verify asymmetry.** `loginSchema` applies only `min(1)` to the password field, not the complexity policy. That is deliberate: validating complexity at login would lock out any user whose password predates a policy change, and would disclose the policy to an attacker probing the form. Any API-side auth implementation must preserve it.

**Status:** Resolved — policy enumerated in Section 3.3.1 with the absent-constraints list and the set-vs-verify asymmetry. Related: [DEBT-015].

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

**Current state:** Every monetary field in the frontend mock data (`price`, `cost`, `total`, `subtotal`, `taxAmount`, `unitPrice`, `unitCost`, `lineTotal`) is a JavaScript `number` holding **major** units — rupees, e.g. `price: 1500` for Rs 1,500. The database and API hold **minor** units, integer paisa (`priceCents: 150000`). Both halves of the boundary now exist and are named so the mismatch is visible:

- `src/lib/format/currency.ts` — `formatMoney` for major units (the mock-data path), `formatMoneyMinor` for the integer paisa the API sends, and `parseMoneyToMinor` for the write direction. All ~35 inline `` `${x.toFixed(2)}` `` sites were replaced with these during the PKR conversion.
- `backend/src/common/validation/money.ts` — `IsMoneyMinor()` rejects non-integers and enforces the int4 ceiling on the way in.

**Impact:** Reduced from "touches every monetary display in every module" to a per-module swap. When a module moves off mock data, its display calls change from `formatMoney` to `formatMoneyMinor` and its writes go through `parseMoneyToMinor`. Note what is explicitly *not* the fix: dividing by 100 at each call site (`(value / 100).toFixed(2)`, as an earlier revision of this entry proposed) reintroduces float arithmetic on exact amounts one site at a time. `formatMoneyMinor` splits whole from fractional paisa with integer arithmetic instead.

**What remains:** the mock-data files still hold major units, and the swap has not happened for any module — that is the backend-integration work itself, not debt. `parseMoneyToMinor` has no call sites yet; it exists so the first person wiring Section 6.7 does not write `Math.round(price * 100)`, which is wrong for real prices (`8.115 * 100` is `811.4999999999999`). It is also untested: the frontend has no test runner (root `package.json` has only `dev`/`build`/`start`/`lint`), so adding one is a prerequisite for covering it.

**Source:** `src/lib/mock-data/orders.ts`, `src/lib/mock-data/products.ts`, `src/lib/mock-data/purchase-orders.ts` — all monetary fields. NFR-14 (fixed-point arithmetic requirement). Identified during Section 4 documentation review. Related: [DEBT-023] (the `*Cents` names), [DEBT-024].

**Status:** Open — deferred to backend integration phase. The conversion boundary is built and documented; the per-module swap is not done.

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
2. **No per-module price exists in the schema.** Section 6.10's example returns `proratedChargeCents: 125000` (Rs 1,250) for enabling `clinic`, but `Plan` prices a whole plan (`priceMonthly`, `priceAnnual`) and `PlanModule` is `{planId, moduleKey}` with no price column. Nothing in Section 5 records what an individual module costs, so the figure cannot be derived from stored data at all.
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

**Blocked on:** ~~Sections 1–3 are not yet committed to the repo~~ — **unblocked.** Sections 1–3 landed in `docs/` (commit "docs: commit Sections 1-3"), so Section 1.5.1 now exists as an editable file.

**Source:** Section 1.5.1 pricing narrative (as quoted in the backend status-sync directive). `backend/src/access-control/access-control.constants.ts` (`CORE_MODULE_KEYS`, `INDUSTRY_MODULE_KEYS`). Raised by the DEBT-016 close. Related: [DEBT-016], [DEBT-018], [DEBT-020].

**Status:** Resolved — `docs/section-1-business-foundation.md` §1.5.1 retires the "pay only for what you use, including Sales/Inventory/POS" clause explicitly (marked as superseding an earlier draft, so the retirement is auditable rather than a silent rewrite) and states the reconciled model: a baseline plan fee covering all eight core modules, with the three industry modules as the only opt-in, individually billable, toggleable items. The engineering model (DEBT-016) was preserved and the narrative moved to it, which is the direction this entry prescribed. **Note:** writing §1.5.1 surfaced a second, distinct contradiction in the same area — see [DEBT-020].

---

### DEBT-020 — Plan tiers differentiate on core modules, which cannot be enforced

**Where it needs to land:** Section 1.5.1 (packaging narrative) and Section 5 / `SEED_PLANS` (the seeded plan module lists). Requires a product decision first.

**What needs to be written:** `SEED_PLANS` gives Starter the module list `[dashboard, inventory, sales, customers]` and Growth those plus `[purchases, reports, settings, billing]`. That implies Growth unlocks four modules Starter does not have. **It cannot.** Two settled decisions make plan-based module differentiation unenforceable:

- **D-03** — `TenantModuleSubscription` is the *sole* access-control authority; `Plan` and `PlanModule` are billing/onboarding convenience and grant nothing.
- **DEBT-016** — core modules are never subscription-gated; the module-access guard short-circuits every core key to "allowed" and never consults the table for them.

All eight keys in both plan lists are core. So a Starter tenant hitting `purchases` or `reports` is allowed through by the guard exactly as a Growth tenant is; only their role stops them, and role assignment does not depend on plan. **Starter and Growth are therefore not enforceably different** — the difference exists only in the seeded metadata and in whatever a pricing page claims.

This is *not* a restatement of DEBT-019. DEBT-019 was about marketing copy describing core modules as metered; this is about the seeded plan data implying an enforcement boundary that no code implements. Fixing the copy does not fix this.

Three candidate resolutions, in decreasing order of disruption:

1. **Reclassify some core keys as gateable** — reopens DEBT-016 and re-introduces the "row absent → 403" hazard for core modules that the DEBT-016 close specifically removed.
2. **Differentiate plans on something enforceable** — seats, branches, transaction volume, or industry-module allowance. Requires new limit columns and enforcement, but leaves the module taxonomy alone.
3. **Accept price-only tiering** and correct the seeded `modules` lists so they stop implying enforcement that does not exist — cheapest, and honest, but means Starter/Growth differ only in price and add-on allowance.

**Risk if left open:** the plan lists are the most likely thing a future implementer would wire access control to, precisely because they *look* like an entitlement list. D-03 says they are not. A contract test or an explicit comment on `SEED_PLANS` would make the trap visible at the call site.

**Source:** `backend/src/access-control/access-control.constants.ts` (`SEED_PLANS`, `CORE_MODULE_KEYS`), `backend/prisma/schema.prisma` (`Plan`, `PlanModule`, `TenantModuleSubscription`). Surfaced while reconstructing Section 1.5.1. Related: [DEBT-016], [DEBT-018], [DEBT-019], [DEBT-023].

**Status:** Open — product decision required (which of the three options). No option adopted; §1.5.1 records all three and states that the choice is product's. Nothing in code changed on account of this entry.

**Note (PKR conversion):** `SEED_PLANS` no longer carries Section 6.10's literal figures. The example's 1900/4900 are US dollars, and the product is priced in PKR ([DEBT-023]), so the seed now holds Starter at Rs 4,999/month (`499_900` paisa) and Growth at Rs 12,999/month (`1_299_900`), with annual terms keeping the example's twelve-months-for-ten shape. These are FX conversions at roughly 280 PKR/USD rounded to publishable price points — **placeholders, not a pricing decision**, and this entry plus [DEBT-019] are still where the real one belongs. Two e2e assertions in `billing.controller.spec.ts` read the seeded prices, so whoever sets the real numbers changes them there too.

---

### DEBT-021 — Sidebar gates industry modules on a permission, not a subscription

**Where it needs to land:** `src/hooks/use-permissions.ts` (`useModuleAccess`), `src/components/shared/Sidebar.tsx`, and Section 4.5 (the frontend access-control description)

**What needs to be written:** `useModuleAccess(moduleKey)` is implemented as `useCanPerform(moduleKey, Actions.READ)` — a **role-permission** check. But whether an industry module is available is a **subscription** question, answered by `TenantModuleSubscription` and nothing else (D-03, FR-BILL-03). The two are independent gates (Section 3.2), and the hook conflates them under a name that claims to answer the second.

The consequence is visible today. The dev tenant subscribes to **zero** industry modules (`DEV_TENANT_ENABLED_INDUSTRY_MODULES` is deliberately empty), yet an Owner holds `clinic.read`, `pharmacy.read` and `restaurant.read` from the canonical matrix — so the sidebar renders all three. Every one of them leads to a module the API refuses with 403 at chain step 5. The frontend advertises what the backend denies.

Core modules are unaffected: they are never subscription-gated (DEBT-016), so for them a permission check is the whole story and `useModuleAccess` is accidentally correct.

**What the fix requires:**

1. A real source of subscription state — `GET /api/v1/billing/modules` already returns exactly this (implemented, Section 6.10), keyed by module with an `enabled` boolean.
2. Splitting the hook in two, so the names stop lying: `useCanPerform(module, action)` for RBAC and a separate `useModuleEnabled(module)` for subscription, with nav visibility requiring **both** for industry keys and permission alone for core keys.
3. A decision on the UX for a subscribed-but-unpermitted vs unsubscribed module — hide the item, or show it disabled with a route to Billing. Showing it disabled is the better upsell path and matches what the placeholder pages now say; hiding is less confusing. Not decided.

**Blocked on:** the frontend API client. `src/` currently makes no HTTP calls at all — no `fetch`, no `axios`, no `api/v1` reference anywhere — so there is no way to read subscription state yet. This lands with the frontend integration phase, alongside [DEBT-006].

**Interim state:** the five previously-404ing routes now have real pages (commit `41f376f`), and the three industry pages state plainly that the module is a subscription-gated add-on that is not enabled. So the misleading nav item now leads to an honest explanation instead of a 404 — the symptom is contained, the gating bug is not fixed.

**Source:** `src/hooks/use-permissions.ts` (`useModuleAccess`), `src/config/nav.ts` (industry group), `src/components/shared/Sidebar.tsx`. Found while fixing the 404 routes. Related: [DEBT-006], [DEBT-016].

**Status:** Open — frontend correctness gap; the backend behaves correctly and refuses these modules. Blocked on the frontend API client.

---

### DEBT-022 — `DELETE /products/:id` is specified so that no product a business has ever sold can be deleted

**Where it needs to land:** Section 6.6 (`DELETE /products/:id`), and Section 3.x wherever the product lifecycle is described

**What needs to be written:** Section 6.6 specifies that `DELETE /products/:id` returns **409** if the product appears on any `OrderLine` or `POLine`. Implemented as written (`ProductsService.remove`), and tested as written. But the rule makes the endpoint unusable for its actual purpose:

- The products a business wants to remove from its catalogue are, by definition, the ones it has stopped selling — which means they have sold. A product with **no** line history is one that was created by mistake and never traded, which is the only case the endpoint now serves.
- So the ordinary "discontinue this item" operation has no endpoint. The only way to get a product out of the catalogue is `PATCH { isActive: false }`, which happens to work but is not what the spec presents as the removal path.

The history the 409 protects is **already safe without it**, twice over:

1. Delete here is a soft delete (`deletedAt`), so the product row survives and every `OrderLine.productId` / `POLine.productId` FK still resolves. Nothing is orphaned.
2. Both line tables carry a denormalised `productNameSnapshot` precisely so a historical document renders correctly even if the product is renamed or removed (the same pattern as `Supplier.supplierNameSnapshot`, DEBT-003).

A hard delete would need this guard. A soft delete does not, and the guard is what is specified.

**What the fix requires — one of:**

1. **Drop the 409** and let `DELETE` soft-delete regardless of history. Simplest, and consistent with how customers and suppliers already behave (neither checks history, for exactly this reason: the row survives).
2. **Keep the 409 but rename the operation** in the spec, so it reads as "delete a product created in error" rather than the general removal path, and document `PATCH { isActive: false }` as the discontinue path alongside it.
3. **Add an explicit discontinue endpoint** (`POST /products/:id/discontinue`) so intent is recorded in the audit trail rather than inferred from an `isActive` flip. Most work; most honest about what the user meant.

Option 1 is the recommendation. Option 2 is the minimum — the current text describes a general-purpose delete that in practice refuses almost every real call.

**Interim state:** implemented per spec, not per this objection. The 409's message names `PATCH { isActive: false }` explicitly so a caller who hits it is not left without a way forward, and `products.e2e.spec.ts` asserts both the 409 and that the deactivate alternative still succeeds — so if the rule is dropped later, the test that changes is the one that documents this decision.

**Source:** `backend/src/products/products.service.ts` (`remove`, and the header comment), `backend/src/products/products.e2e.spec.ts` ("answers 409 for a product that appears on an order line"). Found while implementing Section 6.6. Related: [DEBT-003].

**Status:** Open — spec objection, raised rather than silently overridden. Needs a product/spec decision between the three options above.

---

### DEBT-023 — Every money column is named `*Cents` and the currency is the Pakistani rupee

**Where it needs to land:** Section 5.10 (naming conventions), Section 5.4 and every model in Section 5 carrying a money column, and NFR-14

**What needs to be written:** The currency is PKR — `TenantSettings.currencyCode` now defaults to `"PKR"` (migration `20260824042604_pkr_default_currency`, backfilled by `20260824042700_backfill_pkr_currency`). Amounts are stored as integer **paisa**, 1/100 of a rupee: `Rs 2,999` is `299900`.

Section 5.10 mandates the suffix `*Cents` for monetary columns, so the schema now says `priceCents`, `costCents`, `subtotalCents`, `totalCents`, `unitPriceCents`, `lineTotalCents`, `priceMonthly`/`priceAnnual` (documented as cents), and `proratedChargeCents` — none of which hold cents. They hold minor units of whatever `currencyCode` says, which for every tenant this product is being built for is the paisa.

This is a naming problem, not a behavioural one. The columns are already correct: `Int`, minor units, no floats (DEBT-012). Nothing computes wrongly. What is wrong is that a developer reading `subtotalCents` has to know the name is a lie, and the natural mistakes it invites are expensive — writing rupees into a paisa column is a 100× error, and it lands in a record BR-03 then forbids editing.

Why the rename was **not** done as part of the PKR change:

1. `*Cents` is what Section 5.10 specifies. Renaming the columns while the convention still says "cents" replaces one inconsistency with a different one and makes the code contradict the design document instead of merely being awkwardly named. The document has to move first.
2. The surface is wide and financial: every money column across `Product`, `Order`, `OrderLine`, `RefundTransaction`, `PurchaseOrder`, `POLine` and `Plan`, plus the `GET`/`POST` wire shapes in Sections 6.6, 6.7, 6.9 and 6.10, the billing DTOs, and a migration. A rename of that size belongs in one deliberate change, not smuggled into a currency default.
3. Sections 6.7–6.9 are specified but not yet implemented (`docs/section-6-api-design.md`), and they add more money fields: `subtotalCents`, `taxAmountCents`, `totalCents`, `unitPriceCents`, `amountCents` on orders and refunds, `unitCostCents` on PO lines. Renaming now and again after those land is two breaking passes over the API.

**What the fix requires:**

1. A decision on the replacement suffix. `*Minor` (`priceMinor`, `subtotalMinor`) is currency-neutral and stays correct if a tenant is ever configured for a currency with a different minor unit. `*Paisa` is more readable but hard-codes PKR into column names, which contradicts `currencyCode` being a per-tenant setting at all.
2. Section 5.10 amended first, then the schema, then the wire shapes — in that order, so the code is never the thing that disagrees with the document.
3. Best sequenced **after** Section 6.9, so orders, adjustments and purchase orders are renamed in the same pass rather than added under the old name and renamed later.

**Interim state:** the *names* still say cents; everything a caller actually reads says paisa. `common/validation/money.ts` exports `MAX_MONEY_MINOR`, `MONEY_MESSAGE` and `IsMoneyMinor()`, and its 422 message reads "must be a whole number of paisa — send 299900 for Rs 2,999", so an API consumer who sends the wrong unit is told the right one in the right currency. The schema header, the money DTO doc comments and the billing wire shapes all state that the suffix is a Section 5.10 leftover and point here. So the misleading name is annotated everywhere it appears rather than silently carried.

**Source:** `backend/src/common/validation/money.ts` (the NAMING paragraph), `backend/prisma/schema.prisma` (header, Section 5.10 conventions block), `backend/src/billing/dto/billing-response.dto.ts`, `backend/src/customers/dto/customer.dto.ts`, `backend/src/suppliers/dto/supplier.dto.ts`. Raised while converting prices to PKR. Related: [DEBT-012], [DEBT-024].

**Status:** Open — naming vs. Section 5.10; deliberately deferred, not overlooked. Blocked on the Section 5.10 amendment and best done after Section 6.9.

---

### DEBT-024 — `PATCH /settings { currencyCode }` reinterprets financial history instead of converting it

**Where it needs to land:** Section 6.4 (`PATCH /settings`), Section 5.4 (`TenantSettings.currencyCode`), and C-01

**What needs to be written:** `currencyCode` is a freely writable tenant setting — Section 6.4 lists it in the PATCH body with no more qualification than a shape rule (ISO 4217). But every money column stores minor units of *that* currency and nothing else records what a stored integer meant when it was written. So changing the code changes the meaning of every existing row without touching its digits: a tenant with `totalCents: 299900` reading as `Rs 2,999.00` becomes one reading `$2,999.00` the moment an Owner picks USD in the settings form. Order totals, refunds and purchase orders all shift by the exchange rate at once, silently, through a 200 response.

BR-03 makes this worse rather than better: the financial records whose meaning just changed are the ones that may not be edited afterwards.

Section 6.4 does not say what changing the currency means, and there is no conversion endpoint anywhere in Section 6. C-01 ("one currency per tenant") is the closest thing to a rule, and read strictly it implies the currency is a setup-time choice — but nothing in the API enforces that reading.

**What the fix requires — one of:**

1. **Make it setup-only.** Reject the field in `PATCH /settings` once the tenant has any row in `Order`, `RefundTransaction` or `PurchaseOrder` — a 409 naming the reason. Cheapest, and matches how C-01 reads. A tenant that genuinely mis-set its currency before trading can still fix it.
2. **Define a conversion operation.** A dedicated endpoint that takes a rate, converts every money column in one transaction, and writes an audit record of the rate and the operator. Correct, considerably more work, and needs a decision on how BR-03 tolerates a bulk rewrite of frozen records.
3. **Store the currency per financial record** (`Order.currencyCode` and so on), so history keeps the currency it was written in and only new records use the new setting. Most faithful to what multi-currency actually means, and the largest schema change.

Option 1 is the recommendation, and it is a guard rather than a feature: it stops the silent case without committing the product to multi-currency.

**Interim state:** nothing enforced. The DTO comment on `currencyCode` states plainly that changing it reinterprets rather than converts, and that Section 6.4 defines no conversion path, so the hazard is documented at the point of change. `settings.e2e.spec.ts` covers the shape rules only — a currency name (`'Rupees'`) and a display symbol (`'Rs'`) are both 422 — not the history question, which needs Section 6.7 order fixtures to test.

**Source:** `backend/src/settings/dto/update-settings.dto.ts` (`currencyCode`), `backend/prisma/schema.prisma` (`TenantSettings`). Raised while converting prices to PKR. Related: [DEBT-023], [DEBT-012].

**Status:** Open — real data-integrity hazard reachable through a specified endpoint today. Needs a product decision; option 1 is implementable now.

---

### DEBT-025 — Section 6.7 says a client-submitted order total is "silently ignored"; the API refuses it with `422`

**Where it needs to land:** Section 6.7 (`POST /orders`, "Server-computed fields"), and Section 6.1's validation conventions

**What needs to be written:** Section 6.7 states: "If client-submitted totals are present in the body, they are silently ignored." The implementation does the opposite. `CreateOrderDto` does not declare `subtotalCents`, `taxAmountCents` or `totalCents`, and the global `ApiValidationPipe` runs with `forbidNonWhitelisted: true`, so a body carrying any of them is rejected with a `422` naming the offending field. Same for `unitPriceCents` on a line.

The departure is deliberate, and the reason is BR-03. A silent ignore answers `201 Created` to a client that submitted `totalCents: 5000`. That client has no way to distinguish "we accepted your total" from "we discarded it and computed our own", and the natural reading of a `201` is the first one. The record it just created is a financial transaction that BR-03 forbids editing afterwards — so the one place the API should be loudest about a misunderstanding is the one place the section asks it to be silent.

Refusing is also what the rest of the codebase already does with a server-owned field: `PATCH /products/:id` does not accept `stock`, and a client that sends it gets a `422` rather than a `200` that quietly dropped it (Section 6.6, line 403). Making orders the single exception would mean the money path is the *least* strict surface in the API.

**A second, smaller mismatch in the same section:** Section 6.7 says that after `status = 'Completed'`, the financial columns are locked and "any attempt to modify them returns `409`". No route exists through which to attempt it — there is no `PATCH /orders/:id`, and `PATCH /orders/:id/status` accepts only `{ "status": "Completed" }`. So the lock is structural rather than a runtime check, and a client that tries gets `404` (no such route) or `422` (unrecognised field), never the `409` the section promises. The guarantee holds; the status code in the document does not describe any reachable response.

**What the fix requires:** amend Section 6.7 to specify the refusal — `422` with the field named — and drop "silently ignored". Then correct the `409` claim to describe the absence of a write route, or specify a route that would produce the `409` (there is no reason to add one).

**Interim state:** the departure is annotated at both the code and the test. `backend/src/orders/dto/order.dto.ts` states it in the file header with the BR-03 reasoning; `orders.e2e.spec.ts` asserts the `422` for each of the three total fields and for `unitPriceCents`, with a comment pointing here. So the behaviour is pinned by tests and the divergence is discoverable from either side.

**Source:** `backend/src/orders/dto/order.dto.ts` (header, items 1 and 2), `backend/src/orders/orders.e2e.spec.ts` (the `it.each` over the three total fields), `docs/section-6-api-design.md` §6.7. Raised while implementing Section 6.7. Related: [DEBT-026], [DEBT-027].

**Status:** Open — implemented behaviour deliberately contradicts the section's wording. Needs the section amended, not the code.

---

### DEBT-026 — Completing an order moves stock, and Section 6.7 does not say so

**Where it needs to land:** Section 6.7 (`PATCH /orders/:id/status`), cross-referenced from FR-SALE-04, BR-02 and Section 6.8

**What needs to be written:** Section 6.7 describes the completion transition purely as a status change: "Transitions `Order.status` from `Pending` to `Completed`." It says nothing about inventory. FR-SALE-04 and BR-02 do: completing a sale decrements the stock of every product sold, and stock only ever changes through an audited writer. The requirement wins over the section's silence, so `PATCH /orders/:id/status` does considerably more than the section describes:

1. Re-reads the order **inside** the transaction and refuses with `409` unless it is still `Pending`, so two concurrent completions cannot both take stock.
2. Sums quantities **per product** across the lines first — the same product may appear on two lines, and decrementing each line separately would under-count.
3. Decrements `Product.stock` for each product, then asserts the returned value is `>= 0` and rolls the whole transaction back if not.
4. Writes one `StockAdjustment` per product (`type: 'REMOVE'`, `reasonCode: 'Sale'`, `quantityDelta` negative, `newStockLevel` taken from what the update returned, `createdByUserId` from the request context), so BR-02's audit trail covers sales and not just manual adjustments.
5. Sets `status = 'Completed'` last.

All five happen in one `$transaction`. That matters for the failure case, which the section also does not specify: **an order whose lines exceed available stock cannot be completed, and the attempt returns `409` with nothing changed** — stock intact, order still `Pending`, no adjustment rows written. The alternative was to allow the decrement to go negative and let a stock-take correct it later, which was rejected: a negative count is not a state any report in Section 6.9 can interpret, and BR-03 does not apply here (an uncompleted order is not yet a posted transaction), so refusing costs nothing that allowing would preserve.

The section needs to state the side effect, the ordering, the `409` on insufficient stock, and the `409` on a non-`Pending` order — because a client that reads only §6.7 has no reason to expect that a status change can fail for an inventory reason.

**Interim state:** implemented and covered. `orders.e2e.spec.ts` asserts the decrement, the single `Sale` adjustment row, the two-lines-one-product aggregation, the insufficient-stock `409` with all three no-change assertions, and the double-completion `409` proving stock is not taken twice. The service header names FR-SALE-04 as the authority that overrides the section's silence.

**Source:** `backend/src/orders/orders.service.ts` (`updateStatus`, and the service header's third bullet), `backend/src/orders/orders.e2e.spec.ts`. Raised while implementing Section 6.7. Related: [DEBT-025], [DEBT-027], [DEBT-002].

**Status:** Open — code implements a requirement the API section omits. Needs Section 6.7 amended to match FR-SALE-04.

---

### DEBT-027 — Section 6.7's refund endpoint has no upper bound, no status precondition, and no stated effect on stock

**Where it needs to land:** Section 6.7 (`POST /orders/:id/refund`), cross-referenced from BR-03 and Section 6.8's `Returned` reason code

**What needs to be written:** Section 6.7 says partial refunds are allowed, repeated refunds are allowed, and `status = 'Refunded'` means "at least one refund exists — not necessarily fully refunded." It does not say what bounds any of it. Three questions the implementation had to answer:

1. **How much can be refunded in total?** The sum of an order's refunds is capped at `Order.totalCents`. A refund of more than was charged is not a refund, and BR-03 leaves no way to correct one after the fact. Each request aggregates `RefundTransaction.amountCents` for the order and refuses with `409` if the new amount exceeds what remains, naming the remaining figure. Without this, repeated partial refunds have no ceiling at all — "multiple refunds are permitted" read literally allows refunding an order indefinitely.
2. **Can a `Pending` order be refunded?** No — `409`. A `Pending` order has taken no money and moved no stock, so there is nothing to reverse. An already-`Refunded` order *stays* refundable, because that is exactly the partial-refund case the section does allow.
3. **Does a refund restore stock?** No, deliberately. A v1 `RefundTransaction` is an order-level amount with no line attribution — the model has no `OrderLine` FK, which Section 5.11 defers to v2 — so the server cannot know which goods came back or how many. Inferring a quantity from the amount would corrupt the count BR-02 exists to keep honest. Goods physically returned are booked through `POST /inventory/adjustments` with `reasonCode: 'Returned'` (§6.8), which is why that reason code exists as something distinct from `Sale`. The section should say this outright, because "creates a `RefundTransaction` and sets status" reads as though the reversal is complete, and an implementer of the frontend refund flow needs to know a second action is required.

**What the fix requires:** state the three rules in §6.7 with their status codes, and add the pointer to §6.8's `Returned` path so the money reversal and the goods reversal are documented as two steps rather than one.

**Interim state:** all three implemented inside one `$transaction` and covered by `orders.e2e.spec.ts` — accumulating partial refunds, the overshoot `409`, the `Pending` `409`, and an assertion that stock is unchanged after a refund. The service's `refund` doc comment carries the reasoning for the stock decision and names the `Returned` alternative.

**Source:** `backend/src/orders/orders.service.ts` (`refund` — the doc comment and the two `ConflictException`s), `backend/src/orders/orders.e2e.spec.ts`. Raised while implementing Section 6.7. Related: [DEBT-025], [DEBT-026].

**Status:** Open — under-specified endpoint; the code chose bounds the section leaves open. Needs Section 6.7 amended to record them.

---

### DEBT-028 — `quantityDelta` means three different things, and Section 6.8 documents only one of them

**Where it needs to land:** Section 6.8 (`POST /api/v1/inventory/adjustments`), cross-referenced from Section 5's `StockAdjustment` model and from Section 6.7's completion path

**What needs to be written:** The field carries three distinct meanings, and a reader of §6.8 can only work out one of them:

1. **On the wire, for `ADD`/`REMOVE`, it is an unsigned magnitude and `type` carries the sign.** §6.8's own request example is `{"type": "REMOVE", "quantityDelta": 5}` — positive five, on a removal — so this reading is at least implied by the example. A client never sends a negative number; one that tries is refused with `422`.
2. **In the column it is signed.** That same request stores `-5`. The schema comment says so ("positive for ADD/COUNT increase; negative for REMOVE"), and Section 6.7's completion path already writes it that way (`quantityDelta: -quantity`) so both writers of `Product.stock` agree. §6.8 never mentions the conversion, so read on its own it says the stored value is `5` — which would make the audit log sum to the opposite of the truth.
3. **For `COUNT` it is neither** — it is the absolute new stock level, and the stored delta is `quantityDelta - currentStock`, which may be negative, positive or zero. §6.8 *does* state this one, and it is the reason a bare `@Min(1)` would be wrong: a stock take may legitimately find an empty shelf, so `0` is a valid `COUNT`.

The hazard is specifically in (2), because an implementation that gets it backwards still returns plausible responses. A `newStockLevel` of `5` after removing `5` from `10` is correct whichever sign was stored; the error surfaces only later, when someone sums `quantityDelta` over a date range to reconcile shrinkage and gets a number with the wrong sign.

**There is also a frontend field-name seam.** `src/components/inventory/StockAdjustmentDialog.tsx` sends a field named **`quantity`** (positive magnitude), not `quantityDelta`. The API refuses `quantity` outright — `forbidNonWhitelisted` makes an unknown property a `422` — so the mock-data swap for the Inventory module must rename the field at the boundary. That is a genuine rename rather than a formatting difference, and it is the kind of mismatch discovered at runtime rather than at compile time, because the dialog's form state is local and not typed against the API.

**What the fix requires:** state all three readings in §6.8 in the terms above, say explicitly that the server converts the wire magnitude into a signed column value, and note that a client-sent negative is a `422`. Then either rename the dialog's field to `quantityDelta` or record the mapping in whatever API-client layer the swap introduces.

**Interim state:** implemented and covered. `backend/src/inventory/dto/inventory.dto.ts` carries the three readings in its header comment as the current best description, and `inventory.e2e.spec.ts`'s `quantityDelta sign` and `COUNT` blocks assert the **stored** value directly — not just the response — including the negative, positive and zero `COUNT` deltas. The frontend still sends `quantity`; nothing was changed there, because that dialog is still driven by mock data.

**Source:** `backend/src/inventory/dto/inventory.dto.ts` (header comment), `backend/src/inventory/inventory.service.ts` (`create`), `backend/src/inventory/inventory.e2e.spec.ts`, `src/components/inventory/StockAdjustmentDialog.tsx`. Raised while implementing Section 6.8. Related: [DEBT-012], [DEBT-026].

**Status:** Open — the section documents one of three meanings of its own field. Needs §6.8 amended; the code is correct and tested.

---

### DEBT-029 — Section 6.8 says how an adjustment succeeds and never says how one is refused

**Where it needs to land:** Section 6.8 (`POST /api/v1/inventory/adjustments`, and a note on `GET /api/v1/inventory/alerts`)

**What needs to be written:** §6.8 describes the happy path in three sentences and specifies exactly one status code (`201`). Five refusals and one structural property had to be decided in code:

1. **Insufficient stock is `409`, with nothing changed.** PROV-BR-07 (stock may not go negative) is enforced server-side; the message names the quantity actually available. `StockAdjustmentDialog.tsx:75` already checks it, but that is a UX affordance, not a guarantee — the same client-affordance-versus-guarantee split DEBT-002 draws for PO transitions. Note this binds `REMOVE` only: `COUNT` is absolute, so counting `1` against a believed `100` is a legitimate stock take, not a conflict.
2. **`Sale` and `PurchaseReceived` are not client-submittable — `422`.** The column permits six reason codes; a client may send four (`Received`, `Returned`, `Damaged`, `Correction`). The other two are written by the system when an order completes (§6.7) or a PO is received (§6.9). Accepting them here would let a user file a sale-shaped audit row with no order behind it, which defeats the reconciliation the audit log exists to make possible. §6.8 never enumerates the set at all — its example just happens to use `Damaged`.
3. **A zero-quantity `ADD` or `REMOVE` is `422`.** It changes nothing and would leave a meaningless row in an append-only log. Zero is accepted for `COUNT`, where it means the shelf is empty (see DEBT-028).
4. **A bad `productId` or `branchId` in the body is `422`, not `404`.** The addressed resource is the adjustment collection, which exists; the body is what is wrong — the same reading `users.service.ts` takes for a bad `roleId`. A soft-deleted product or branch is refused the same way, but an **inactive** product is still adjustable, because a retired product line's remaining stock still has to be written off.
5. **A single adjustment is capped, and so is the resulting level.** `Product.stock` is `int4`, so an `ADD` that would carry it past 2,147,483,647 is `422` rather than a Postgres overflow, and one adjustment is bounded at 1,000,000 units — a figure above that is far likelier to be a misplaced decimal point than a delivery, and unlike an order an adjustment can be corrected afterwards, so refusing costs the operator little.
6. **The log is append-only.** There is no `PATCH` and no `DELETE` on an adjustment, and no service method for either; a wrong adjustment is corrected by filing a compensating one. That is what keeps the log a history rather than a mutable opinion about the current count (BR-02). §6.8 does not say it, so the absence reads as an oversight rather than a decision — §6.7 makes the equivalent point explicitly under "No DELETE /api/v1/orders/:id", which is the pattern to follow.

**Also worth a line:** `GET /inventory/alerts` caps each array at 200 and orders `lowStock` scarcest-first, so a truncated list drops the least urgent rather than an arbitrary tail. The two buckets §6.8 already defines are disjoint, which is deliberate and differs from `GET /products?lowStock=true`'s looser `stock <= reorderPoint` — right for a filter, wrong for a widget that shows both counts side by side and would otherwise double-report a product sitting at zero.

**What the fix requires:** add a refusals list to §6.8 with the status codes above, enumerate the client-submittable reason codes and name the two that are system-only, and add a "No PATCH or DELETE on an adjustment" subsection in the shape §6.7 already uses for orders.

**Interim state:** all six implemented; `inventory.e2e.spec.ts` covers each, including that a refused adjustment leaves no audit row and no stock change, that an inactive product is still adjustable while a soft-deleted one is not, and that `PATCH`/`DELETE` on an adjustment return `404`.

**Source:** `backend/src/inventory/inventory.service.ts`, `backend/src/inventory/inventory.controller.ts` (header comment), `backend/src/inventory/dto/inventory.dto.ts`, `backend/src/inventory/inventory.e2e.spec.ts`. Raised while implementing Section 6.8. Related: [DEBT-002], [DEBT-026], [DEBT-028].

**Status:** Open — code implements six rules the section omits. Needs §6.8 amended to record them.

---

### DEBT-030 — `GET /customers` returns no order aggregates, so the customers list cannot show what a customer is worth

**Where it needs to land:** Section 6.6 (`GET /api/v1/customers`), and Section 2 FR-CUST-*

**What needs to be written:** whether a customer list row carries any summary of that customer's trading history, and if so, what each figure counts.

The mock-driven customers page had two columns the API cannot fill: **Total Orders** and **Total Spend**. `GET /customers` returns the customer record only — name, contacts, `isActive`, timestamps. `GET /customers/:id` embeds a page of order history, so the figures are reachable, but only one customer at a time: rendering them in a ten-row table means eleven requests, and the count would still be the page size rather than the total.

Both columns were therefore **dropped** when the page was wired, rather than filled with a per-row fetch or a fabricated number.

The reason they cannot simply be added is that neither is well defined yet, and the definitions are business decisions rather than implementation details:

1. **Total Orders — over which statuses?** Counting `Pending` orders means the figure moves when an order is completed and moves again if it is abandoned. Counting only `Completed` means a customer with a full basket at the till reads as never having bought anything.
2. **Total Spend — gross or net of refunds?** A customer who bought Rs 100,000 and returned all of it has spent Rs 100,000 by one reading and Rs 0 by another. Both are defensible; they answer different questions ("how much have we invoiced them" vs "how much have we kept"), and a single unlabelled column cannot mean both.
3. **Over what window?** Lifetime, or a trailing period? A lifetime figure makes a long-dormant customer look active.

Note this is the mirror of the `customerName`/`lineCount` join added to `GET /orders`: that one was added because a customer's name on their own order needs no business definition, whereas these two do. The distinction is worth recording so the next such gap is decided the same way rather than by whichever is easier.

**What the fix requires:** decide the three questions above, then either add the aggregates to `GET /customers` as named fields whose names state their answer (`completedOrderCount`, `netSpendCents`, not `totalOrders`/`totalSpend`) or state in §6.6 that the list is deliberately record-only and the figures live on the detail view.

**Interim state:** the two columns are absent from `src/app/(dashboard)/customers/page.tsx`. `CustomerDetail.orders` (a paginated envelope) is the only order data any customer view has, and the detail dialog renders it as a list rather than a total.

**Source:** `backend/src/customers/customers.service.ts`, `src/lib/api/customers/queries.ts` (`Customer` vs `CustomerDetail`), `src/app/(dashboard)/customers/page.tsx`. Raised while wiring the Customers page to the API. Related: [DEBT-023].

**Status:** Open — two list columns were removed rather than guessed. Needs §6.6 to say whether they come back and what they count.

---

### DEBT-031 — The frontend permission matrix is a second copy of the backend's, and a custom role renders a dead UI

**Where it needs to land:** Section 6.4 (roles and permissions), and Section 4 (System Architecture) as an authority statement

**What needs to be written:** which artefact is the authority on what a role may do, and how a client learns it.

There are currently two independent answers. `src/config/permissions.ts` holds a hard-coded module × action matrix per built-in role name, and `useCanPerform()` reads it to decide whether to render a button. The backend holds `RolePermission` rows and enforces them per request. Nothing keeps the two in agreement, and the frontend copy has a structural limit the backend does not: it is keyed by **role name**, so it can only describe the four built-in roles.

The consequence is specific and user-visible. `POST /roles` creates custom roles with arbitrary permission sets (Section 6.4). A user assigned such a role gets a lookup miss in the frontend matrix, which fails closed — so the UI hides every gated action, including ones the server would allow. The user sees an application with no buttons, and nothing in the interface explains why. Their requests would succeed if they could be made.

The fail-closed direction is the right default and should stay: a visible button that 403s is worse than an absent one. But it is a safe failure of a wrong design, not a correct behaviour.

**The fix is for the session to carry the viewer's effective permissions.** `GET /auth/me` already returns the user's role; it should return the permission set that role resolves to, and `useCanPerform` should read that instead of a local table. Then a custom role works with no frontend change, the two copies collapse into one, and the client's answer is derived from the server's rather than kept in step with it by hand.

**What the fix requires:** add the resolved permission set to `GET /auth/me`'s response in §6.2, state in §6.4 that `RolePermission` is the sole authority, and record that any client-side permission check is a rendering affordance whose only legitimate source is that response. Then delete the role-keyed matrix.

**Interim state:** `src/config/permissions.ts` remains the frontend's source, and every wired page gates on it (`useCanPerform(Modules.SALES, Actions.REFUND)` and similar). This is correct for the four built-in roles and wrong for any custom role.

**Source:** `src/config/permissions.ts`, `src/contexts/role-context.tsx`, `backend/src/access-control/access-control.constants.ts`, `backend/src/auth/auth.controller.ts` (`GET /auth/me`). Raised while wiring the Sales page's refund gate. Related: [DEBT-021].

**Status:** Open — a custom role currently sees a UI with its actions hidden. Needs `/auth/me` to carry permissions.

---

### DEBT-032 — Dashboard and Reports read mock orders, and the wired Sales page no longer feeds them

**Where it needs to land:** no SRS section — this is an implementation-sequencing note, recorded here because it is a **visible behaviour regression** that would otherwise look like a bug

**What needs to be written:** nothing, in the documents. What needs recording is that the state is known and temporary.

`OrdersProvider` (`src/contexts/orders-context.tsx`) holds a mock order array. Before Sales was wired, placing an order pushed a fabricated `OrderRecord` into it, so a new sale immediately appeared in the Dashboard's metrics and in the Reports page's figures. Both of those pages still read that context.

Now that Sales posts to `POST /orders`, it no longer writes to the context — the order goes to the database and comes back through `GET /orders`. So:

- **Sales history is real.** It reflects the database, paginates server-side, and survives a reload.
- **Dashboard and Reports are still mock, and are now also static.** They show the seeded array and no longer gain a row when a sale is made.

That is a loss of an illusion rather than a loss of data: those pages were never showing real figures, and a fabricated row appearing in a mock total was misleading in a way that is easy to mistake for working software. But an operator who places an order and sees the dashboard unchanged will read it as a fault, so it must not sit unexplained.

`use-dashboard-metrics.ts` and `reports/page.tsx` are the two remaining consumers. `OrdersProvider` and `ProductsProvider` can both be deleted once those are wired — no earlier, because removing them now would leave two pages unable to render at all.

**What the fix requires:** wire the Dashboard (composed from `GET /orders`, `GET /inventory/alerts` and `GET /products` — there is no dashboard endpoint) and the Reports page (needs Section 6.11, which does not exist yet). Then delete both providers and the `src/lib/mock-data/` modules they read.

**Source:** `src/contexts/orders-context.tsx`, `src/hooks/use-dashboard-metrics.ts`, `src/app/(dashboard)/reports/page.tsx`, `src/app/(dashboard)/sales/page.tsx`. Raised while wiring the Sales page.

**Status:** Open — expected to close when Dashboard and Reports are wired. Tracked so the static dashboard is not diagnosed as a defect.

---

### DEBT-033 — `PurchaseOrder` has no tax columns, so `totalCents` can only ever equal `subtotalCents`

**Where it needs to land:** Section 6.9 (purchase orders), and Section 5's data model alongside the `PurchaseOrder` table

**What needs to be written:** either that a purchase order is deliberately tax-free at this stage, or the two columns that would make the total mean something.

`Order` carries `taxRateBps` and `taxAmountCents`, so its `totalCents` is a genuinely different number from its `subtotalCents`. `PurchaseOrder` carries neither. Section 6.9 nevertheless instructs the server to compute *both* `subtotalCents` and `totalCents` from the lines — and with no tax, no freight, no discount and no other adjustment column, that computation produces the same integer twice.

So `totalCents` is, today, a duplicate of `subtotalCents` in every row the API can write. `PurchasesService.computePOTotals` returns it that way and the response exposes both, because the column exists and a client reading `totalCents` should not have to know it is currently redundant.

The reason this is debt rather than a bug is that it hides a real question: **is purchase-side tax out of scope, or unbuilt?** A business buying stock in Pakistan pays sales tax on the purchase and generally reclaims it, which is exactly the kind of figure a purchase ledger is expected to carry. If that is deliberately deferred, the document should say so, because the schema currently *looks* like it forgot. If it is not deferred, the fix is columns and a migration, not a code change.

Two smaller consequences worth noting when this is decided:

- **Section 6.11's supplier-spend report will aggregate `totalCents`.** Whatever that column comes to mean, the report inherits it — so the answer here decides whether "spend" means tax-inclusive or not.
- **The frontend PO form has no tax field.** It matches the schema today, which means adding tax later is a schema change *and* a form change, not just a backend one.

**What the fix requires:** a decision, then either one sentence in Section 6.9 ("a purchase order records the pre-tax cost of goods; purchase tax is out of scope for v1") or a migration adding `taxRateBps` and `taxAmountCents` to `PurchaseOrder`, with `computePOTotals` and the PO DTO following.

**Source:** `backend/prisma/schema.prisma` (`model PurchaseOrder`), `backend/src/purchases/purchases.service.ts` (`computePOTotals`), `backend/src/purchases/dto/purchase-order.dto.ts` (`PurchaseOrderResponse.totalCents`). Raised while building Section 6.9.

**Status:** Open — the API is internally consistent; what is missing is the statement of intent.

---

### DEBT-034 — A purchase order does not say which branch receives the goods

**Where it needs to land:** Section 6.9 (purchase orders), and Section 5's data model on the `PurchaseOrder` table

**What needs to be written:** which branch a delivery lands in, and when that is decided.

`StockAdjustment.branchId` is **required** — every stock movement is attributed to a branch, which is what makes a per-branch count possible at all. `Order` carries `branchId` for the same reason: a sale happens somewhere.

`PurchaseOrder` carries no `branchId`. But receiving a PO writes stock adjustments — `SYSTEM_REASON_CODES` in Section 6.8's DTO reserves `PurchaseReceived` for exactly this — and each of those rows needs a branch. Nothing in the PO says which one.

`PurchasesService.applyReceipt` resolves it to the tenant's **default branch**: `isDefault: true` first, then the oldest active branch as a fallback so a tenant whose seed never set the flag still receives stock. That is correct for the single-branch tenant the seed describes, and it is the only answer available without a migration. It is wrong the moment a tenant has two branches and a delivery arrives at the second one: the goods are counted at head office and the receiving branch's shelves read empty.

The gap is narrower than it looks, because the *right* fix is not obvious and the document has to choose:

- **`PurchaseOrder.branchId`, set when the PO is raised** — the buyer names the destination up front. Simple, and matches how `Order.branchId` works. Wrong if a PO is routinely split across branches on arrival.
- **A branch on the receipt rather than the PO** — chosen at `PATCH /:id/status` when `toStatus` is `Received`. More faithful to how deliveries actually arrive, and it makes partial receipt across branches expressible later.

The first is a column and a form field. The second is a body on a status transition that currently takes one field, and it changes what the endpoint means.

**What the fix requires:** a decision in Section 6.9, then a migration. Until then, multi-branch tenants must not use purchase orders — which is neither enforced nor stated anywhere a user would see.

**Source:** `backend/prisma/schema.prisma` (`model PurchaseOrder`, `model StockAdjustment`, `model Branch.isDefault`), `backend/src/purchases/purchases.service.ts` (`applyReceipt`, `defaultBranchId`). Raised while building Section 6.9.

**Status:** Open — the single-branch case is correct; the multi-branch case silently books goods to the wrong branch.

---

### DEBT-035 — `Product.embedding` is a fixed-size pgvector column that locks the AI feature to one embedding model

**Where it needs to land:** Section 5 (ERD — the new `Product.embedding` / `Product.embeddingText` columns), and Section 4 (the AI feature's external-dependencies list, beside the provider row)

**What needs to be written:** the schema, the model, and the swap path for Smart Search embeddings.

`Product.embedding` is `vector(1536)`, the dimensionality of OpenAI's `text-embedding-3-small` (the default `AI_EMBEDDING_MODEL`). The dimension is part of the column type, so changing it is a `DROP COLUMN` + re-`ADD COLUMN` + full re-embed — the HNSW index has to come down with the column, and the partial index only works while the column exists. A migration that changes the type is **not** cheap, and the cost falls on every existing tenant.

Three things this affects, all of which the spec section this lands in has to record:

1. **Why the column is in raw SQL, not Prisma.** Prisma 7 has no native vector type. The column is added in `backend/prisma/migrations/20260830000000_smart_search_pgvector/migration.sql` and exposed to the client as `embedding String? @ignore` and `embeddingText String? @ignore` — `@ignore` keeps the field off the generated client (its writes happen through `$executeRaw` and `$queryRaw`), and `String?` is the smallest valid Prisma type the validator will accept (a more honest "owned by raw SQL" annotation does not exist in v7). The model comment explains both.
2. **The 1536-dimension coupling.** This dimension is the right size for `text-embedding-3-small` (and a few older 1536-dim models). A 3072-dim model — `text-embedding-3-large`, or any model that produces longer vectors — cannot be swapped in by changing the env var; the migration path is a new migration that drops the column, adds a new one with the new dimension, and triggers a catalogue-wide re-embed. So the "provider-agnostic" promise of `AIProviderInterface` is a little smaller than it looks: the **interface** is provider-agnostic, the **storage** is dimension-agnostic only up to the size that was chosen. Recorded here so a future reader does not assume the column can be resized by setting an env var.
3. **`embeddingText` is a backfill marker, not a flag.** Without an AI provider, every product write records the text the embedding *would* have been generated from, so a later activation can backfill in one pass: "rows with `embedding IS NULL` AND `embeddingText IS NOT NULL`" is the working set. A bare "needs embedding" boolean would have done the same job but lost the text once it was consumed, which would mean a partial re-embed on a second model change would have nothing to embed from. The mirror column is the slightly more honest design.

**Also worth a sentence in Section 4:** the extension `vector` is **not** in stock Postgres 17 — it ships in `postgresql-17-pgvector` on Debian/Ubuntu images and in most managed Postgres offerings (Neon, Supabase, RDS, Hetzner-managed) but is not part of `postgres:17-alpine` by default and has to be added with `apk add postgresql17-pgvector` or equivalent. The migration runs `CREATE EXTENSION IF NOT EXISTS vector` so it is recoverable on a stock image, but the host that runs the production database must be one where the extension is installable, and that is a deployment-decision moment (Section 4.8) that has to name pgvector, not just "Postgres 17".

**What the fix requires:** a Section 5 row on the new columns (typed, nullable, raw-SQL-owned, dimension-locked), a Section 4 row on pgvector as an external dependency, and a note in the AI section that the dimension is chosen at migration time and is part of the contract.

**Interim state:** the column, the index, the mirror column and the fail-soft sync hook are all in place and verified on the dev instance. A backfill on AI enable is one script away from working once a provider is configured.

**Source:** `backend/prisma/migrations/20260830000000_smart_search_pgvector/migration.sql`, `backend/prisma/schema.prisma` (`Product` model, `@ignore` fields and comment), `backend/src/ai/embedding.service.ts`, `backend/.env.example` (AI block with the dimension note), `backend/src/products/products.service.ts` (fire-and-forget hooks). Raised while implementing the AI Phase 1 Smart Search. Related: [DEBT-034].

**Status:** Partially resolved — schema decision recorded and the hybrid ranking from the brief is implemented (`backend/src/ai/search.service.ts`, RRF with `k=60`); the coupling between model choice and column dimension is the kind of thing a Section 5 reader has to be told explicitly. The ranking itself is filed under [DEBT-039] for doc-sync.

---

### DEBT-036 — Spec identifiers quoted in the AI implementation brief do not exist in the spec

**Where it needs to land:** Sections 2 (FR-AI-* and FR-REP-*) and the Business Rules section BR-*

**What needs to be written:** decisions the AI Phase 1 brief referenced by identifier that no spec section defines. Three of them, each a real spec gap:

1. **FR-AI-04 does not exist.** The brief asks the implementation to label AI-generated insights in the UI and cites "BR-08" as the rule. The label was implemented, but no FR-AI-04 says the feature exists at all. The closest section is FR-AI-03 (Dashboard Health Score + Reports insights), which names the score and the insights but does not name the labeling requirement. Section 2 needs an FR-AI-04 that says "every AI-generated text rendered in the UI must be visually distinguishable from a non-AI string", and points at the BR the brief cited.
2. **FR-REP-04 does not exist.** The brief's reference to "Reports insights" (FR-AI-03's second half) is real and implemented, but the section that defines the Reports insight list is FR-REP-03 (existing reports). There is no FR-REP-04 in the spec text. Either the brief was reading ahead of the section, or the section number drifted. The implementation chose the "dashboard insights feed into the Reports page later" path, which is the right one but is not in the spec.
3. **BR-08 is the PO state machine, not the AI-label rule.** The brief calls BR-08 the requirement that AI outputs be labeled. `BR-08` in the spec is the purchase-order state machine (Draft → Sent → Received/Cancelled). The actual rule the brief was reaching for is closer to BR-04 (no AI may be presented as a human) or no existing BR at all — it has to be added. The implementation labels AI insights anyway, because the requirement is right; the *citation* was wrong. The next reviewer who grep's "BR-08" in the code will find PO state transitions, not labeling.

The pattern across all three is the same: the AI Phase 1 brief referenced a tidy set of spec identifiers, and those identifiers are not the ones the spec has. The implementation is sound, but the cross-references a future maintainer will follow are pointing at the wrong sections.

**What the fix requires:** a sweep of the AI spec for missing FRs, a decision on whether BR-08 keeps the PO state machine or migrates to the labeling rule (recommend: add a new BR for the labeling rule, keep BR-08 as the PO state machine — they are unrelated concerns and a renumber is more disruption than the new rule is worth), and a corresponding update to the brief / implementation notes so the next phase cites the right identifiers.

**Interim state:** labeling is implemented (`InsightsCard` shows an "AI-generated" badge on every insight with `aiGenerated: true`); the spec citation the implementation is filed under does not exist.

**Source:** `backend/src/ai/`, `src/components/dashboard/InsightsCard.tsx` (the `aiGenerated` rendering branch), the AI Phase 1 brief in the prior session's transcript. Raised during the DEBT-035 review of the AI Phase 1 build. Related: [DEBT-035].

**Status:** Open — implementation is correct, citations are wrong. Needs the spec amended, not the code.

---

### DEBT-037 — AI re-embed is CLI-only; `POST /ai/reembed` is a stub that returns immediately

**Where it needs to land:** Section 6.12 (the AI admin endpoints, where the re-embed contract is described), and Section 2's FR-AI-03 (operational requirements)

**What needs to be written:** what `POST /api/v1/ai/reembed` is actually doing today, and what it has to do for a multi-tenant production deployment.

`POST /ai/reembed` is wired and protected (requires `settings.write`), and it correctly refuses if no AI provider is configured. Beyond that, it does not run a job: it counts the rows that need embedding, generates a job ID, and returns `{ jobId, productsToProcess, message: "Re-embed job queued. Use the CLI (npm run ai:reembed) to process." }`. The real work happens only when an operator runs the CLI script, which iterates tenants sequentially and processes products in batches. The controller is honest about this — the message tells the caller to use the CLI — but the contract is two-step (HTTP request, then a separate process) and there is no progress signal, no completion notification, and no record of who started it.

For a single-tenant dev instance that is fine: an operator with shell access runs the script. For a managed multi-tenant deployment it is not, because:

1. **The operator has to log in to the backend container** to run the script, which is a deployment surface most managed hosting does not expose.
2. **There is no audit trail of who triggered a re-embed, when, or how many succeeded.** A row that fails partway through leaves the catalogue half-embedded, and a second invocation is required without any way to know the first stopped where it did. `embedding` and `embeddingText` are both nullable, so the row is in the working set again by definition.
3. **Concurrent re-embeds from different tenants** are not coordinated. Two tenants clicking "Re-embed" five seconds apart each spawn a CLI run (or would, if the endpoint queued anything), and both hammer the OpenAI endpoint with the same working set of rows.
4. **There is no per-tenant concurrency control.** A 50,000-SKU tenant can monopolise the OpenAI rate limit and stall other tenants' re-embeds.

**What the fix requires:** a proper async job system. BullMQ + Redis is the natural choice for a Node backend and is the one already proposed (and deferred) in the AI controller's TODO. The endpoint then returns a real job ID, the operator polls a `GET /ai/jobs/:id` for progress, and the worker respects per-tenant concurrency and provider rate limits. A `AIReembedJob` Prisma model (tenantId, status, totals, startedAt, finishedAt, error) gives an audit row for free. Until that exists, the CLI is the only honest path and the endpoint should stay labelled as a stub.

**Interim state:** the endpoint is implemented, the CLI (`backend/src/ai/reembed-all.ts`, `npm run ai:reembed`) is implemented, and the controller message points operators at the CLI. The gap is between the two: there is no automated bridge.

**Source:** `backend/src/ai/ai.controller.ts` (`triggerReEmbed`, the `// TODO: Implement proper job queue` line and the response message), `backend/src/ai/reembed-all.ts`. Raised while wiring AI Phase 2 admin endpoints. Related: [DEBT-035].

**Status:** Open — works for dev/single-tenant; a multi-tenant production deployment needs a real job system.

---

### DEBT-038 — AI feature has no runtime toggle; absence of `AI_API_KEY` at boot is the only switch

**Where it needs to land:** Section 6.12 (AI admin endpoints) and Section 2 (FR-AI-01 graceful degradation)

**What needs to be written:** how an operator turns AI features off and on without a redeploy, and what the right granularity is.

Today the only switch is `AI_API_KEY` in the environment. The `AIModule` factory reads it once at construction:

```
const apiKey = config.get<string>('AI_API_KEY');
if (apiKey) return new OpenAICompatibleAIProvider(config);
return new NoopAIProvider();
```

That means the choice is fixed for the lifetime of the process. To turn AI off, an operator sets `AI_API_KEY=""` and restarts the backend; to turn it back on, restart with the key set. Two production-shaped scenarios this cannot answer:

1. **A provider outage that is not the operator's fault.** If OpenAI returns 5xx for an hour, every `search()` and every health-insights generation logs the error, retries three times, and returns the text-search fallback. The user-visible behaviour is correct (FR-AI-01), but the logs are noisy and the retries cost money. A runtime toggle — "AI is off for the next hour" — would suppress both at the provider boundary, not at every call site.
2. **A per-tenant kill switch.** If a particular tenant's data has triggered a privacy review (or they are on a trial that excludes AI), there is no way to disable AI for that tenant only. They would have to be moved to a deployment without an API key, which is not a thing a multi-tenant SaaS can do.

The right shape is a `TenantSetting.aiEnabled` (or a global one) read in the same place the factory reads the API key — but the factory runs once per process, not per request, so the call site is the per-request service methods. A small wrapper that the services check first would work without restructuring the provider interface.

**What the fix requires:** a runtime feature flag (per-tenant is the most flexible, global is the minimum) and a single check in each of the four provider-method call paths (`SearchService.search`, `HealthInsightsService.generate`, `EmbeddingService.syncProduct`). The provider itself stays as-is; the call sites become one-liners. Until this exists, "AI off" means "restart the process", which is too coarse for production.

**Interim state:** the boot-time switch works and the graceful-degradation contract is honoured. The cost of leaving it as is is operational: every operator action to disable AI is a redeploy.

**Source:** `backend/src/ai/ai.module.ts` (the factory, line 45), `backend/src/ai/search.service.ts` (`ai.isConfigured()` checks at the call sites), `backend/src/ai/health-insights.service.ts`. Raised while implementing the OpenAI provider. Related: [DEBT-035], [DEBT-037].

**Status:** Open — works as designed; designed for boot-time configuration, not runtime.

---

### DEBT-039 — `SearchService` hybrid ranking fills from text but does not score vector rows that are missing in text

**Where it needs to land:** Section 6.12 (the Smart Search endpoint) and Section 4.5 (the AI feature's behaviour description)

**What needs to be written:** the exact ranking rule and its single, documented quirk.

The Phase 1 brief asked for hybrid ranking so that a tenant with a partially-embedded catalogue (some products have `embedding`, others have only `embeddingText` set) still gets a full result set. The implementation uses Reciprocal Rank Fusion (RRF, `k=60`):

```
score(d) = 1/(k + rank_vector(d)) + 1/(k + rank_text(d))
```

A document that appears in only one list gets one term; a document in both gets two. Rows are then sorted by descending score and trimmed to 20.

The RRF math is right, but the implementation has one quirk worth recording so the next reader does not call it a bug. **The text list is filtered to exclude rows already returned by the vector list before RRF runs.** That sounds redundant (RRF de-duplicates on the same id anyway), but it matters here because the text list and the vector list use **different filters**: the vector query applies `embedding IS NOT NULL` and a similarity floor, while the text query applies `ILIKE` over `name`/`sku`/`category`. A product with an embedding that did not match the query closely enough is *not* in the vector result, so it can still legitimately match the text path. The pre-filter is "rows the text path would re-add", not "rows the vector path already has", and a row that scores highly on the text path but is missing from the vector result still appears in the merged top-20 with a `similarity: null` on the wire.

`SearchProductHit` declares `similarity?: number` for exactly this reason: a row that came from the text path has no similarity to report, and the client renders it without a score. The shape of that omission is the contract; a future change that adds a similarity for text-only rows would be a different ranking, not a bug fix.

**What the fix requires:** state the rule in Section 6.12, in roughly the words above, and add `similarity: number | null` to the documented response shape (it is already `?: number` in code, which is close enough; the spec should say "null when the row came from the text path, a float in [0, 1] otherwise"). Until that is written, the omission reads as an oversight.

**Interim state:** implemented and covered by tests; the gap is in the doc.

**Source:** `backend/src/ai/search.service.ts` (`combineResults`, the `RRF_CONSTANT = 60` and `MAX_RESULTS = 20` constants, and the line where the pre-filter happens), `backend/src/ai/dto/search.dto.ts` (`SearchProductHit.similarity?`). Raised while implementing the hybrid ranking.

**Status:** Open — code is correct, doc is silent on the rule.

---

### DEBT-040 — `prisma migrate deploy` reaches Supabase over TLS but does not verify the server chain

**Where it needs to land:** Section 4.8 (deployment / data protection) and Section 9 (non-functional: security), wherever the database transport guarantee is stated.

**What needs to be written:** that the guarantee is not uniform across the two connections this system opens to Postgres.

Supabase serves a cert chained to a private root (`Supabase Root 2021 CA`) that Node does not ship. The **application's** pool pins it correctly: `buildPgConfig` (`backend/src/prisma/pg-config.ts`) reads `DATABASE_CA_CERT_PATH` and passes `ssl: { ca, rejectUnauthorized: true }` to `PrismaPg`, so every query the API issues runs over a connection whose chain was verified against that root. Substituting a wrong CA fails the handshake with `SELF_SIGNED_CERT_IN_CHAIN`, which is the proof that verification is actually on rather than nominally configured.

The **schema engine's** connection — the separate process behind `prisma migrate deploy`, run by `backend/docker-entrypoint.sh` on every container start — does not. Measured against the live project, `prisma migrate status` succeeds in all of these cases:

| Configuration | Expected if verifying | Actual |
| --- | --- | --- |
| `PGSSLROOTCERT` = the real root | pass | pass |
| `PGSSLROOTCERT` unset | fail (untrusted root) | **pass** |
| `PGSSLROOTCERT` = a bogus PEM | fail | **pass** |
| URL `?sslmode=verify-full&sslrootcert=<bogus>` | fail | **pass** |

So the engine reads neither libpq's `PGSSLROOTCERT` nor the URL's `sslrootcert`, and does not verify the chain it is given. The connection is still encrypted — Supabase refuses plaintext outright (`XX000 SSL connection is required for user: postgres`) — so this is an authentication-of-the-server gap, not a confidentiality one: migrations are exposed to an active MITM that can present any cert, not to passive interception.

The blast radius is small but not nil. The window is the moments around container start; the credential on that connection is the same `DATABASE_URL` password the app uses, so a successful MITM captures it. Nothing in the repo currently claims otherwise — the docs were corrected in the same change that raised this — but the temptation to read the `PGSSLROOTCERT` in `docker-compose.supabase.yml` as the thing that makes migrate safe is exactly why this needs writing down.

**What the fix requires:** decide and document the intended posture. Options, cheapest first: (a) accept it, state it explicitly in Section 9, and rely on the network path being trusted; (b) stop running `migrate deploy` from the entrypoint and apply migrations from a controlled host or CI step over a connection whose TLS you do control; (c) route the engine through a local proxy (`stunnel`, `pgbouncer`, the Supabase connection pooler's own verified endpoint) that terminates a verified session. Re-test the table above on each Prisma upgrade — if a release adopts libpq semantics, the `PGSSLROOTCERT` already set in the overlay makes this resolve itself, and the docs should stop hedging.

**Interim state:** `PGSSLROOTCERT` is set in `docker-compose.supabase.yml` and `backend/.env` because it is correct for `psql`/`pg_dump` in the same container and is forward-insurance; every doc that mentions it now says plainly that Prisma does not honour it.

**Source:** probed against the live Supabase project while finishing the CA-pinning change; `backend/docker-entrypoint.sh` (the `migrate deploy` call), `docker-compose.supabase.yml`, `backend/src/prisma/pg-config.ts`.

**Status:** Open — behaviour confirmed by measurement, posture undecided, docs no longer misstate it.

---

## Resolved

*(None yet — items move here when the corresponding SRS section is written and reviewed.)*
