# Section 1: Business Foundation

> **Document status:** **Reconstructed.** Sections 1–3 were cited throughout Sections 4–6, `DOCUMENTATION_DEBT.md`, and the source code, but were never committed to this repository. This document is rebuilt from those citations so that every identifier they reference resolves to a definition.
>
> Three provenance markers are used throughout:
> - **[pinned]** — the rule was already fixed by a citation in a committed document or by shipped code. Transcribed, not invented.
> - **[reconstructed]** — no citation pinned this; it is a coherent proposal consistent with everything that *is* pinned. Open to correction.
> - **[open]** — a genuine product decision that has **not** been made. Deliberately left unspecified rather than invented, because a fabricated number here would silently become the spec.
>
> Identifiers defined here and consumed elsewhere: `D-01`–`D-03`, `BR-01`–`BR-10`, `C-01`–`C-05`.

---

## 1.1 Problem Statement

Small and medium businesses run their operations on a patchwork of disconnected tools: a spreadsheet for stock, a notebook or a standalone POS for sales, a separate ledger for supplier bills, and WhatsApp for everything else. Each tool is individually adequate and collectively incoherent. The costs are structural, not cosmetic:

- **Stock figures are never trustworthy.** A sale recorded in the POS does not decrement the spreadsheet, so the number on screen is always a guess with an unknown error bar.
- **There is no single financial history.** Refunds, supplier credits, and cash adjustments live in different places, so "what did we actually earn last month" requires manual reconciliation.
- **Growth makes it worse.** A second location multiplies the number of disconnected copies rather than being absorbed by the system.
- **Vertical requirements force a bad trade.** A pharmacy needs batch and expiry tracking; a clinic needs appointments; a restaurant needs table and course management. General-purpose SME software ignores these, and vertical-specific software abandons the general ledger and inventory quality that every business needs regardless of trade.

MBOS exists because the second trade-off is false. Vertical needs are a **thin layer over shared core entities**, not a reason to buy a separate system. *[pinned — Section 4.4 restates this as "the principle from Section 1".]*

## 1.2 Product Vision

> A single operational system of record for an SME — inventory, sales, customers, purchasing, and reporting — that a business can adopt on day one for its general operations and extend with its industry's specific needs without migrating, re-keying, or running a second system.

Three commitments follow from that sentence and govern every later section:

1. **One source of truth.** Every stock-affecting or money-affecting action writes to the same entities. No module maintains a private copy of a number another module owns.
2. **Correct before featureful.** Financial and inventory integrity outrank surface area. A number displayed by MBOS must be defensible to an accountant.
3. **Extensible without forking.** Adding a vertical adds a module; it never requires a parallel deployment, a schema branch, or a second codebase.

## 1.3 Target Market

**Primary:** owner-operated and owner-managed businesses of roughly 3–50 staff, single or few locations, that sell physical goods or goods-plus-services and currently run on spreadsheets plus a standalone POS. *[reconstructed]*

**Launch verticals** — the three that exist as industry modules today *[pinned — `INDUSTRY_MODULE_KEYS`]*:

| Vertical | Module key | Representative need beyond core |
|---|---|---|
| Pharmacy | `pharmacy` | Batch, expiry, and controlled-substance handling |
| Clinic | `clinic` | Patients, appointments, procedure billing |
| Restaurant | `restaurant` | Tables, courses, kitchen routing |

**Explicitly not the target at launch:** enterprises needing multi-entity consolidation, businesses whose primary need is manufacturing/MRP, and pure-service businesses with no inventory dimension. *[reconstructed]*

## 1.4 Scope

**In scope for v1** — the core modules, which every tenant has *[pinned — `CORE_MODULE_KEYS`]*: `dashboard`, `inventory`, `sales` (including POS), `customers`, `purchases`, `reports`, `settings`, `billing`.

**In scope, opt-in** — the industry modules: `clinic`, `pharmacy`, `restaurant`.

**Out of scope for v1** *[reconstructed, except where noted]*:

- Payroll, HR, and accounting-ledger replacement (MBOS feeds an accountant; it is not the general ledger)
- Manufacturing / bill-of-materials
- E-commerce storefront and public-facing catalogue
- Multi-entity or multi-currency consolidation *(single currency per tenant — see C-01)*
- Per-line refund attribution *[pinned — Section 5 defers this to v2 alongside `PROV-FR-SALE-05`]*
- Microservice decomposition *[pinned — Section 4.1: the migration path is kept open but not designed for]*

## 1.5 Business Model

MBOS is sold as a subscription per tenant. A tenant is one business; a user belongs to exactly one tenant (D-01).

### 1.5.1 Pricing and Packaging

> **This subsection supersedes an earlier draft.** The prior narrative described the model as *"pay only for what you use, including Sales/Inventory/POS."* That clause is **retired** and must not be reused in onboarding or marketing copy. Sales, Inventory, and the POS are **core**: always available to every tenant, never carrying a `TenantModuleSubscription` row, never toggled, never separately metered. *[pinned — DEBT-016 / DEBT-019.]*

The model as it actually stands:

- **A baseline plan fee covers every core module.** All eight core modules are included in every plan and are gated by role permissions only, never by subscription. A tenant cannot buy "MBOS without Inventory", and cannot cancel it.
- **Industry modules are the only opt-in, individually billable items.** `clinic`, `pharmacy`, and `restaurant` are the only keys that ever appear in `TenantModuleSubscription`, and therefore the only things a toggle can enable or disable (UC-04).
- **Enabling or disabling an industry module takes effect on the next request** — not the next deployment, not the next login. *[pinned — FR-BILL-03, UC-04.]*

**Plan catalogue** *[pinned — transcribed from the Section 6.10 `GET /plans` example and seeded by `SEED_PLANS`]*:

| Plan | Monthly | Annual | Annual framing |
|---|---|---|---|
| Starter | $19.00 (`1900`) | $190.00 (`19000`) | Ten months for the price of twelve |
| Growth | $49.00 (`4900`) | $490.00 (`49000`) | Same ratio |

All monetary values are integer minor units (cents). See NFR-14.

**[open] — industry-module add-on pricing does not exist.** There is no per-module price anywhere in the system: `PlanModule` has no price column, and no invoice entity exists. Consequently the proration figure returned by `PATCH /billing/modules` is `null` rather than a fabricated number. Setting add-on prices is a product decision that must precede any proration work. *[pinned — DEBT-018.]*

**[open] — plan tiers currently differentiate on core modules, which cannot be enforced.** This is a live contradiction, surfaced while writing this section, and it is not the same issue as the retired "pay only for what you use" clause:

`SEED_PLANS` gives Starter the module list `[dashboard, inventory, sales, customers]` and Growth additionally `[purchases, reports, settings, billing]`. But `Plan.modules` is explicitly **informational only** — `TenantModuleSubscription` is the sole access-control authority (D-03) — and core modules are never gated by it. So a Starter tenant reaching `purchases` or `reports` is allowed through by the module-access guard exactly like a Growth tenant; only their role stops them, and their role does not depend on their plan. **The two plans are therefore not enforceably different.** Three possible resolutions, in order of decreasing disruption:

1. Reclassify some core keys as gateable, reopening DEBT-016.
2. Keep core ungated and differentiate plans on something enforceable instead — seats, branches, transaction volume, or industry-module allowance.
3. Accept that Starter and Growth differ only in price and in the industry-module allowance, and correct the seeded module lists so they stop implying enforcement that does not exist.

Tracked as **DEBT-020**. No option is adopted here; the choice is product's.

### 1.5.2 What a Tenant Gets on Signup *[reconstructed]*

One tenant record, one Owner user, the three built-in roles, all core modules, and no industry modules. The development seed matches this shape deliberately — it subscribes the dev tenant to zero industry modules so the guard's refusal path stays testable. *[pinned — `DEV_TENANT_ENABLED_INDUSTRY_MODULES`.]*

## 1.6 Foundational Architectural Commitments

Two decisions are business-level, not technical preferences, and are recorded here because later sections cite this section as their origin.

**MBOS is a modular monolith at launch.** *[pinned — Section 4.1: "This decision was made in Section 1."]* One frontend deployable, one backend deployable, module boundaries enforced by convention and static analysis rather than process or network separation (NFR-10). The business reason: the per-module access control the billing model requires must be checked on every request, and implementing that correctly across distributed services at SME scale costs more than it returns.

**Industry modules are thin layers over shared core entities.** *[pinned — Section 4.4 attributes this principle to Section 1.]* A pharmacy's batch tracking extends the shared Product and Stock entities; it does not introduce a parallel product catalogue. This is what makes a vertical an add-on rather than a fork, and it is the technical precondition for 1.5.1's packaging.

## 1.7 Constraints

| ID | Constraint | Provenance |
|---|---|---|
| **C-01** | One currency per tenant, stored as integer minor units. No multi-currency or FX handling in v1. | [reconstructed] — consistent with Section 5.1's cents-only rule |
| **C-02** | The stack is fixed: Next.js (frontend), NestJS (backend), PostgreSQL via Prisma. No second datastore, no ORM alternative, no runtime language change. | [pinned] — universal across Sections 4–6 and the codebase |
| **C-03** | Hosting: Vercel is the primary frontend host; the backend runs as a container on a managed platform (DigitalOcean or Hetzner class), deliberately **not** hyperscaler-only. No Kubernetes at launch. | [pinned] — Section 4.9 cites C-03 by name |
| **C-04** | SME-scale operational budget. A single backend container behind a reverse proxy is the launch topology; no orchestration, service mesh, or distributed tracing. | [pinned] — Section 4.9 |
| **C-05** | The development database is a shared, disposable instance. It holds no production data, and every test suite must clean up the rows and sessions it creates rather than accumulating them. | [pinned] — cited by five test files and the seed |

## 1.8 Business Rules

Enforced in the Domain layer *[pinned — Section 4.2 places "BR-01 through BR-10" there]*. BR-03 is transcribed from its many citations; the rest are reconstructed to be consistent with shipped validation and schema.

| ID | Rule | Provenance |
|---|---|---|
| **BR-01** | Tenant isolation is absolute. No request may read or write another tenant's rows, and isolation is enforced at the query layer, never only in the UI. | [pinned] — FR-TEN-04, Section 4.3 |
| **BR-02** | Every stock-affecting transaction adjusts inventory in the same transaction that records it. A sale and its stock decrement either both commit or neither does. | [reconstructed] |
| **BR-03** | **Financial immutability.** Once a financial record is posted (`status = 'Completed'`), its monetary columns are locked and the record is never hard-deleted. Corrections are made by **reversing entries**, not edits: a refund is a new `RefundTransaction`, never an `UPDATE` on the order. Entities referenceable by a financial record use soft deletes (`deletedAt`). Destructive endpoints for posted transactions do not exist at all — not even as a 403. | [pinned] — cited in Sections 4, 5, 6, the schema, and `permissions.ts` |
| **BR-04** | Stock may not go negative. An adjustment or sale that would take on-hand below zero is refused. | [pinned] — `PROV-BR-07` |
| **BR-05** | Money is computed server-side. Totals, tax, and line extensions are calculated by the API from stored prices and rates; client-supplied totals are never trusted or persisted. | [pinned] — Section 5/6: financial columns are server-computed and not updatable |
| **BR-06** | A SKU is unique within a tenant and is at least 3 characters. Uniqueness is per tenant, not global. | [pinned] — `PROV-BR-03` (length); [reconstructed] (scope of uniqueness) |
| **BR-07** | Stock quantities are integers. Fractional stock is not representable in v1. | [pinned] — `PROV-BR-08` |
| **BR-08** | Purchase-order status follows a fixed state machine (`Draft → Sent → …`, with `Cancelled` reachable from the pre-receipt states). The server re-validates every transition; client-side enforcement is UX only. | [pinned] — `PROV-FR-PUR-05`, DEBT-002 |
| **BR-09** | A refund may not exceed the refundable balance of its order. Partial refunds are permitted; cumulative refunds above the order total are refused. | [pinned] — Section 5.11 (partial refunds supported); [reconstructed] (the cumulative ceiling) |
| **BR-10** | Financial records are self-describing. Mutable reference data is snapshotted onto the record at write time, so renaming or deactivating a source row cannot retroactively change history. | [pinned] — Section 5.1 "Snapshots", DEBT-003 |

## 1.9 Success Criteria *[reconstructed]*

Adoption is meaningful only if the system becomes the business's actual record, so the criteria are about displacement, not usage minutes:

1. **Stock trust** — a tenant stops maintaining a parallel stock spreadsheet within 30 days.
2. **Sales completeness** — effectively all revenue events pass through MBOS rather than a subset.
3. **Vertical pull-through** — a meaningful share of tenants in a launch vertical enable their industry module, validating the add-on model in 1.5.1.
4. **Correctness** — zero incidents of cross-tenant data exposure, and zero financial-history mutations. These are pass/fail, not trend metrics.

## 1.10 Decision Register

| ID | Decision | Consequence |
|---|---|---|
| **D-01** | One User belongs to exactly one Tenant — a foreign key on `User`, not a join table. | Login resolves the tenant from the email alone; no tenant selector at sign-in. *[Section 6.3, DEBT-014.]* |
| **D-02** | The three built-in roles (Owner/Manager/Cashier) are **global** (`tenantId IS NULL`, `isBuiltIn = true`) and are never deleted. Custom roles are tenant-scoped. | A tenant can add roles but cannot redefine or remove the built-ins. *[Section 5.3, FR-SET-02.]* |
| **D-03** | `TenantModuleSubscription` is the **sole** access-control authority for module availability. `Plan` and `PlanModule` are billing and onboarding convenience only and grant nothing. | Plan membership never confers access. Combined with core-is-never-gated, this is what produces the DEBT-020 gap in 1.5.1. |

*Section 5 restates D-01 through D-03 in its preamble as the schema decisions confirmed before it was written.*

**Decisions still owed** — recorded so they are not mistaken for settled: industry-module add-on pricing and the proration rule (FR-BILL-02, DEBT-018), and the plan-differentiation question (DEBT-020).

## 1.11 Documentation Debt

Addressed by this section:

| Item | Status in this section |
|---|---|
| DEBT-019 — "pay only for what you use" contradicts the Core/Industry model | **Resolved.** 1.5.1 retires the clause and states the baseline-plus-add-ons model that DEBT-016 requires. |

Raised by this section:

| Item | Target |
|---|---|
| DEBT-020 — Plan tiers differentiate on core modules, which cannot be enforced | Section 1.5.1 (packaging) + Section 5 (`SEED_PLANS` module lists) — product decision |

Still open elsewhere:

| Item | Target section |
|---|---|
| DEBT-018 — Proration (FR-BILL-02, per-module price, invoice entity) | Section 2 (the requirement), Section 5 (pricing column), Section 8/9 (invoices) |
