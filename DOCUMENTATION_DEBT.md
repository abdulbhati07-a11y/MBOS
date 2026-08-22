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

**What needs to be written:** Specific numeric thresholds for:
- Per-tenant request rate (requests per minute/second)
- Per-IP request rate for unauthenticated endpoints (login, signup)
- Burst allowance before throttling kicks in
- Which endpoints (if any) have stricter per-endpoint limits (e.g., auth endpoints to prevent credential stuffing)
- The `429` response shape and `Retry-After` header format

**Current state:** Section 6.1 has the structural description (per-tenant vs per-IP, burst allowance, `429 + Retry-After`) with TBD markers on numeric values. Rate limiting is named as a security requirement in the NFR list but no concrete thresholds were ever specified in Sections 1–3.

**Implementation status (interim):** The mechanism is now built — `backend/src/rate-limit/` — with provisional thresholds in `rate-limit.config.ts`, each carrying the reasoning for the number chosen: 10/min per IP on login and mfa/verify, 120/min per IP otherwise, 300/min per tenant, ×1.5 burst allowance. All four are overridable by env var (`RATE_LIMIT_*`, documented in `backend/.env.example`), so resolving this item should mean changing configuration, not code. The `429` body and `Retry-After` header match Section 6.1 exactly.

**Additional unspecified item — proxy trust:** The per-IP limit keys on `req.ip`, which is the socket address unless Express is configured with `trust proxy`. Behind a load balancer without it, every request appears to originate from the balancer and one noisy client would throttle every tenant at once; trusting `X-Forwarded-For` too permissively lets a client forge the header and evade the limit entirely. Sections 4–6 do not specify the deployment topology, so the correct setting cannot be chosen yet. This must be decided alongside the thresholds.

**Source:** Section 6.1 rate-limiting subsection — TBD markers. Section 2 NFR list — rate limiting named but unnumbered. Identified during Section 6 outline review. Interim implementation and the proxy-trust question added during the Section 6.2 middleware build.

**Status:** Open — numeric thresholds and the proxy-trust setting require explicit product/infrastructure decisions. Interim values implemented and isolated to config.

---

### DEBT-014 — Login-time tenant resolution unspecified

**Where it needs to land:** Section 6.3 (POST /auth/login) and Section 5 (User uniqueness model)

**What needs to be written:** How the server decides *which tenant's* User record a login attempt is checked against. Section 6.3 says login "validates email and password against the current tenant's User record," but at login time no session — and therefore no tenant context — exists yet, and the platform defines no subdomain/Host-based tenant routing. Section 5 makes email unique per `(tenantId, email)`, **not** globally (`User @@unique([tenantId, email])`), so one email address may legitimately belong to several tenants. Nothing in Section 6.3 resolves that ambiguity. A decision is required between:
1. **Tenant carried on the request** — an explicit `tenantSlug`/`tenantId` in the login body, or one derived from a subdomain / `Host` header.
2. **Global email uniqueness** — change the Section 5 constraint to `email @unique` so an address maps to exactly one user.
3. **Return-and-choose** — respond with the list of tenants for that email and let the client pick, then re-submit.

**Current state:** The backend implements option 1 as an *optional* `tenantSlug` on `LoginDto`. Both "no candidate" and "more than one candidate" collapse to an identical generic `401` (issued only after a decoy bcrypt comparison), so the response cannot be used to enumerate which emails or tenants exist. This is an interim mechanism, not the documented contract — Section 6.3 still needs the canonical strategy written down.

**Source:** `backend/src/auth/dto/login.dto.ts` — `tenantSlug` field and comment. `backend/src/auth/auth.service.ts` — `login()`, `candidates.length !== 1` branch. `backend/prisma/schema.prisma` — `User @@unique([tenantId, email])`. Identified during the Section 6.3 auth implementation.

**Status:** Open — interim `tenantSlug` mechanism implemented; canonical tenant-resolution strategy requires a product/architecture decision and must be written into Section 6.3.

---

### DEBT-015 — Password reset endpoints specified but not implementable from the current schema

**Where it needs to land:** Section 6.3 (POST /auth/password/forgot, POST /auth/password/reset), Section 5 (ERD — a password-reset-token entity), Section 4 (external dependencies — transactional email)

**What needs to be written:** Two prerequisites the specified endpoints depend on but that no section defines:
1. **A reset-token entity.** Section 5's ERD has `RefreshToken` but nothing to persist a single-use, expiring password-reset token. `POST /auth/password/reset` ("consumes a reset token and sets a new password … existing refresh tokens for this user are revoked") cannot be built without one. Needs a `PasswordResetToken` model — `userId` FK, `tokenHash` unique, `expiresAt`, `usedAt` — stored hashed at rest, mirroring how `RefreshToken` keeps only a digest.
2. **A mail transport.** `POST /auth/password/forgot` "initiates email-based password reset," but no email/transactional-mail provider is chosen anywhere in Sections 4–6.

**Current state:** Both endpoints are documented in Section 6.3 but are **deliberately not implemented** in the auth vertical slice. Building them now would mean inventing a data model and an infrastructure dependency the design docs do not define. The password-complexity rules they would enforce are themselves still open (DEBT-001).

**Source:** `docs/section-6-api-design.md` §6.3 — `password/forgot` and `password/reset`. Absence of a reset-token model in `backend/prisma/schema.prisma` and Section 5. No mail transport named in Sections 4–6. Identified during the Section 6.3 auth implementation.

**Status:** Open — blocked on a Section 5 schema addition (`PasswordResetToken`) and a Section 4 mail-transport decision; endpoints omitted from the implemented slice until both exist. Related: [DEBT-001].

---

### DEBT-016 — Module-key taxonomy diverges across layers

**Where it needs to land:** Section 5.3 (`RolePermission.module`, `TenantModuleSubscription.moduleKey`) and Section 6.2 (which module each endpoint group belongs to)

**What needs to be written:** One canonical list of module keys, and where it lives.

Section 5.3 states that `module` values "match the `Modules` and `Actions` TypeScript enums exactly", and Section 4 (lines 158–173) states that the frontend's `DEFAULT_ROLE_PERMISSIONS` *becomes* the `RolePermission` seed data, the TypeScript constant being "the frontend's optimistic cache of this data". That makes `src/config/permissions.ts` canonical. Three problems follow:

1. **`billing` exists only on the backend.** Section 6.10 defines billing endpoints, so the API needs a `billing` module key, but the frontend `Modules` enum has no `BILLING` member. The backend now grants `billing` to Owner only — an **inference**, not a documented rule: Section 6.10 states no required permission for its endpoints, and the canonical matrix has no `billing` row to copy. This needs confirming.
2. **The backend was missing four keys the frontend has.** `dashboard`, `clinic`, `pharmacy` and `restaurant` were absent from the backend's module list, so under the fail-closed module check every endpoint in those modules would have returned `403`. Now added.
3. **The list is mirrored by hand in two files** — `src/config/permissions.ts` and `backend/src/access-control/access-control.constants.ts` — so it can drift again silently, which is exactly how the divergence below arose. It should be generated from one source, or a test should assert the two agree.

**Related — the divergence this replaced (resolved in code, still needs writing up):** before the Section 6.2 build, `backend/src/prisma/seed.ts` granted more than the canonical matrix — Manager had `settings.write` plus `delete` on inventory/customers/purchases; Cashier had `customers.write` and `reports.read`. That was inert while nothing read the table, but the permission guard makes `RolePermission` live authorization, so a Manager would have been able to create branches and custom roles (Section 6.4/6.5 gate those on `settings.write`) while the UI hid the controls. The seed now mirrors the canonical matrix cell-for-cell and *prunes* non-canonical rows for built-in roles; `access-control.e2e.spec.ts` asserts that Manager cannot write settings and Cashier cannot read reports, so it cannot silently regress.

**Source:** `src/config/permissions.ts` (`Modules`, `DEFAULT_ROLE_PERMISSIONS`) vs `backend/src/access-control/access-control.constants.ts` (`MODULE_KEYS`, `ROLE_MATRIX`). `docs/section-5-database-design.md` line 146. `docs/section-4-system-architecture.md` lines 158–173. `docs/section-6-api-design.md` §6.10. Identified while implementing chain steps 5 and 6.

**Status:** Open — code reconciled to the canonical matrix; the canonical *list* (including whether `billing` belongs in the frontend enum, and who may access it) still needs writing into Sections 5.3/6.2, and the hand-mirroring replaced. Related: [DEBT-007].

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

*(None yet — items move here when the corresponding SRS section is written and reviewed.)*
