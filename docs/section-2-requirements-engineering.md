# Section 2: Requirements Engineering

> **Document status:** **Reconstructed.** See the preamble to Section 1 for the provenance markers used here — **[pinned]**, **[reconstructed]**, **[open]**.
>
> Identifiers defined here and consumed elsewhere: `FR-AUTH-*`, `FR-TEN-*`, `FR-INV-*`, `FR-SALE-*`, `FR-CUST-*`, `FR-PUR-*`, `FR-REP-*`, `FR-SET-*`, `FR-BILL-*`, `FR-AI-*`, `NFR-01`–`NFR-18`. Subsection **2.4.4** is cited by Section 4.2 as the home of the `AIProviderInterface` declaration and is numbered accordingly.

---

## 2.1 Purpose and Method

This section is the requirements register: the numbered statements that Sections 4–6 implement and cite. It is deliberately *not* a design document — it says what must be true, not how.

Requirements here have three origins:

1. **Elicited from the problem domain** — the ordinary case.
2. **Ratified from the UI build.** The frontend (Steps 1–12) was built before this register existed and invented provisional identifiers inline, prefixed `PROV-`. Those were placeholders pending ratification. This section ratifies them; see 2.2 and the mapping in 2.6.
3. **Extracted from shipped code.** Where the backend implemented a behaviour before it was written down, the behaviour is authoritative and this register records it. Those cases are tracked in `DOCUMENTATION_DEBT.md` and marked here as resolved.

## 2.2 Identifier Scheme

| Prefix | Meaning | Defined in |
|---|---|---|
| `FR-<MODULE>-NN` | Functional requirement, scoped to a module | 2.3 |
| `NFR-NN` | Non-functional requirement, globally numbered | 2.4 |
| `BR-NN` | Business rule (domain invariant) | Section 1.8 |
| `C-NN` | Constraint (external, non-negotiable) | Section 1.7 |
| `D-NN` | Recorded decision | Section 1.10 |
| `UC-NN` | Use case | Section 3.4 |
| `PROV-…` | **Provisional.** Coined in frontend code before ratification. | — |

**On `PROV-` identifiers.** A `PROV-` prefix means "this rule is real but its identifier is not yet canonical." Ratification **preserves the number** — `PROV-FR-INV-02` becomes `FR-INV-02`, not a renumbered ID. This is a deliberate choice: dozens of code comments cite the provisional forms, and renumbering would invalidate every one of them. Dropping the prefix is therefore a no-op for readers of the code. *[reconstructed]*

## 2.3 Functional Requirements

### 2.3.1 Authentication and Identity — `FR-AUTH-*`

| ID | Requirement |
|---|---|
| **FR-AUTH-01** | A visitor can register a new tenant, supplying business name, full name, email, and password. The registering user becomes that tenant's Owner. *[pinned — `signupSchema`]* |
| **FR-AUTH-02** | A user authenticates with email and password alone. The tenant is resolved from the email; no tenant identifier is supplied at login (D-01). *[pinned — DEBT-014, resolved]* |
| **FR-AUTH-03** | Passwords must satisfy the complexity policy enumerated in **Section 3.3.1**. The same policy applies at registration and at password reset. *[pinned — `passwordSchema`; closes DEBT-001]* |
| **FR-AUTH-04** | A user may be challenged for a 6-digit time-based one-time code as a second factor. *[pinned — `mfaChallengeSchema`, `totp.service.ts`]* |
| **FR-AUTH-05** | A user can request a password reset by email and complete it with a single-use, expiring token. The request response must not reveal whether an address is registered. *[pinned — DEBT-015; see Section 3.3.4]* |
| **FR-AUTH-06** | Sessions use a short-lived access token plus a refresh token; the refresh token is delivered as an httpOnly cookie. *[pinned — Section 6.3]* |

### 2.3.2 Tenancy and Branches — `FR-TEN-*`

| ID | Requirement |
|---|---|
| **FR-TEN-01** | Every tenant's data is invisible to every other tenant, without exception (BR-01). |
| **FR-TEN-02** | A tenant may operate multiple branches (locations). Every tenant has at least a default branch. *[pinned — Section 5.2 "resolves FR-TEN-02/03"]* |
| **FR-TEN-03** | Stock is tracked per branch. Orders and stock adjustments are attributable to the branch that produced them. *[pinned — Section 5.15]* |
| **FR-TEN-04** | Tenant filtering is applied at the **query layer**, so no query can reach the database without it. UI-level filtering is never a substitute. *[pinned — Sections 4.3, 6.2 step 4]* |

### 2.3.3 Inventory — `FR-INV-*`

| ID | Requirement |
|---|---|
| **FR-INV-01** | A user with `inventory.write` can create, edit, and soft-delete products. |
| **FR-INV-02** | A product carries at minimum a name, a SKU (≥3 characters, unique per tenant — BR-06), a price in minor units, and a stock quantity. *[ratifies `PROV-FR-INV-02`]* |
| **FR-INV-03** | Product stock is visible per branch, with a tenant-wide total. |
| **FR-INV-04** | Stock can be adjusted with a reason, producing an auditable adjustment record. Adjustments are integers (BR-07) and may not take on-hand below zero (BR-04). *[ratifies `PROV-FR-INV-04`]* |
| **FR-INV-05** | Products below a configurable reorder threshold are surfaced as low-stock. *[reconstructed]* |

### 2.3.4 Sales and POS — `FR-SALE-*`

| ID | Requirement |
|---|---|
| **FR-SALE-01** | A user with `sales.write` can create an order from a product selection, at the POS or in the back office. |
| **FR-SALE-02** | An order records its lines, subtotal, tax amount, and total — all server-computed (BR-05) — and may optionally link a Customer. *[ratifies `PROV-FR-SALE-02`]* |
| **FR-SALE-03** | An order line records the product, quantity, unit price, and a snapshot of the product name at sale time (BR-10). *[ratifies `PROV-FR-SALE-03`]* |
| **FR-SALE-04** | Completing an order decrements stock atomically (BR-02) and locks its financial columns (BR-03). |
| **FR-SALE-05** | A completed order can be refunded by a user holding `sales.refund` specifically — not `sales.write` and not `sales.delete`. Refunds create a reversing record and never mutate the order (BR-03, BR-09). Per-line refund attribution is **deferred to v2**. *[pinned — Section 5.11 defers `PROV-FR-SALE-05`]* |

### 2.3.5 Customers — `FR-CUST-*`

| ID | Requirement |
|---|---|
| **FR-CUST-01** | A user with `customers.write` can create and edit customers; deletion is a soft delete (BR-03). |
| **FR-CUST-02** | An order may be linked to a customer, or left unlinked for walk-in trade. *[pinned — Section 5.9: `customerId` nullable in v1, target non-nullable, DEBT-004]* |
| **FR-CUST-03** | A customer's order history is viewable. A running balance/ledger is **[open]** — see DEBT-010. |

### 2.3.6 Purchases — `FR-PUR-*`

| ID | Requirement |
|---|---|
| **FR-PUR-01** | A user with `purchases.write` can raise a purchase order against a supplier. |
| **FR-PUR-02** | A supplier record carries name and contact details. *[ratifies `PROV-FR-PUR-02`]* |
| **FR-PUR-03** | A purchase order references its supplier by foreign key, and snapshots the supplier name at creation time so later renaming or deactivation cannot corrupt history (BR-10). *[ratifies `PROV-FR-PUR-03`; DEBT-003]* |
| **FR-PUR-04** | A PO line records product, ordered quantity, and unit cost; PO totals are server-computed (BR-05). *[ratifies `PROV-FR-PUR-04`]* |
| **FR-PUR-05** | PO status transitions follow the state machine in BR-08 and are re-validated server-side on every transition. *[ratifies `PROV-FR-PUR-05`; DEBT-002]* |
| **FR-PUR-06** | Receiving stock against a PO increases branch stock atomically (BR-02). |

### 2.3.7 Reports — `FR-REP-*`

| ID | Requirement |
|---|---|
| **FR-REP-01** | Sales, inventory, and purchasing reports are available over a user-selected date range. |
| **FR-REP-02** | Reports can be filtered by branch. *[pinned — Section 5.2/5.9: the frontend had to mark this blocked pending `branchId`]* |
| **FR-REP-03** | Reports are exportable. Format and library are **[open]** — see DEBT-009. |

### 2.3.8 Settings — `FR-SET-*`

| ID | Requirement |
|---|---|
| **FR-SET-01** | A tenant Owner can maintain the company profile, including the tax rate applied to orders. *[pinned — DEBT-008]* |
| **FR-SET-02** | A tenant Owner can create custom roles with arbitrary permission sets, in addition to the three built-in roles (D-02). *[pinned — DEBT-007]* |
| **FR-SET-03** | A tenant Owner can invite, deactivate, and assign roles to users within their tenant. *[reconstructed]* |

### 2.3.9 Billing and Module Subscription — `FR-BILL-*`

| ID | Requirement |
|---|---|
| **FR-BILL-01** | A tenant can view the plan catalogue, its current subscription, and its module subscription state. *[pinned — Section 6.10]* |
| **FR-BILL-02** | **[open] — this requirement does not yet exist.** Section 6.10 states that `effectiveDate` "is used to calculate proration per FR-BILL-02", but no proration rule has ever been written: whether a mid-period enable is charged from the effective date or the period start, whether a disable refunds or credits, and how partial periods round are all unspecified. Until it is written, the API returns `proratedChargeCents: null` rather than a fabricated figure, and the confirmation gate is retained. Blocked additionally on a per-module price (1.5.1) and an invoice entity. *[pinned — DEBT-018]* |
| **FR-BILL-03** | Module access is verified on **every request**, not only at login, and a change takes effect on the next request with no redeployment, no cache flush, and no re-issued token (UC-04). Only industry modules are subject to this check; core modules always pass. *[pinned — Section 6.2 step 5, DEBT-016]* |

### 2.3.10 AI Assistance — `FR-AI-*`

| ID | Requirement |
|---|---|
| **FR-AI-01** | AI features are optional and degrade cleanly: the product is fully usable with the provider unavailable or unconfigured. *[reconstructed]* |
| **FR-AI-02** | No tenant data is sent to an AI provider without that behaviour being an explicit, documented part of the feature. *[reconstructed]* |
| **FR-AI-03** | The Dashboard presents a business Health Score, and Reports present generated insights. Both are currently deferred stubs in the frontend, correctly awaiting the provider interface of 2.4.4. *[pinned — `// TODO: FR-AI-03`]* |

## 2.4 Non-Functional Requirements

### 2.4.1 Performance *[reconstructed]*

| ID | Requirement |
|---|---|
| **NFR-01** | Interactive dashboard and list views reach interactive within 2s on a mid-range device over a typical broadband connection. |
| **NFR-02** | Read API endpoints respond within 300ms at p95 under expected SME load; writes within 500ms. |
| **NFR-03** | A report over a 12-month range returns within 5s, or streams/paginates if it cannot. |

### 2.4.2 Scalability and Capacity *[reconstructed]*

| ID | Requirement |
|---|---|
| **NFR-04** | A single deployment supports the launch tenant population without sharding; tenant count scales by row volume, not by deployment count. |
| **NFR-05** | A tenant supports at least 50 users, 10 branches, and 100k products without architectural change. |

### 2.4.3 Security and Abuse Protection

| ID | Requirement |
|---|---|
| **NFR-06** | All traffic is TLS-only. Credentials are stored only as salted, adaptive hashes — never reversibly encrypted, never plaintext. *[reconstructed]* |
| **NFR-07** | Authorization is deny-by-default. A request whose required module/action cannot be determined is refused, not allowed. *[pinned — DEBT-017: the guard fails closed]* |
| **NFR-08** | **Rate limiting.** Requests are throttled on two independent axes, with burst allowances **additive** to the per-minute rate: <br>• Authenticated, per tenant — **300 req/min, burst 50** (effective 350) <br>• Authentication endpoints, per IP — **10 req/min, burst 3** (effective 13) <br>• All requests, per IP — **120 req/min, burst 40** (effective 160) <br>Per-IP limits are only sound if the client address is trustworthy, so forwarded headers are honoured **only** from a pinned reverse-proxy address or hop count. `X-Forwarded-For` is never trusted unconditionally, and a blanket "trust all proxies" setting is refused at boot. *[pinned — DEBT-013, resolved]* |
| **NFR-09** | Every mutation is attributable: who, when, and to which tenant. Financial history is append-only (BR-03). *[reconstructed]* |

### 2.4.4 Modularity and Provider Abstraction

*This is the subsection Section 4.2 cites as the home of the `AIProviderInterface` declaration.*

| ID | Requirement |
|---|---|
| **NFR-10** | Module boundaries are enforced by convention and static analysis, not by process or network separation. No module imports another module's internals; there are no inter-module HTTP calls within the deployment. *[pinned — Section 4.1, 4.4 "What is prohibited"]* |
| **NFR-11** | AI capability is consumed through an **`AIProviderInterface`** declared in the Domain/Application layer and implemented in Infrastructure. No Application-layer code imports a vendor SDK directly, and swapping providers must not touch Application code. *[pinned — Section 4.2 cites this subsection by number]* |
| **NFR-12** | Outbound email is consumed through a **`MailProvider`** interface bound by injection token, so a transport can be selected without touching callers. A no-op implementation is the default until a transport is chosen; it must neither log credentials or tokens nor reveal whether an address exists. *[pinned — DEBT-015, `MAIL_PROVIDER`]* |

### 2.4.5 Availability and Recoverability *[reconstructed]*

| ID | Requirement |
|---|---|
| **NFR-13** | 99.5% monthly availability target at launch, with daily backups and a documented restore procedure. Recovery point ≤24h, recovery time ≤4h. |

### 2.4.6 Financial Correctness

| ID | Requirement |
|---|---|
| **NFR-14** | **All monetary arithmetic is fixed-point on integer minor units.** No `FLOAT`, `REAL`, or `DECIMAL` column for money; no native floating-point arithmetic on monetary values anywhere in the stack. Division and percentage operations (tax, proration, discounts) use a fixed-point library with an explicit rounding mode. Formatting (`value / 100`) is a Presentation-layer concern only. *[pinned — Sections 4.2, 4.6, 5.1, DEBT-012]* |

### 2.4.7 Accessibility and Internationalisation *[reconstructed]*

| ID | Requirement |
|---|---|
| **NFR-15** | Interactive surfaces meet WCAG 2.1 AA: keyboard operability, visible focus, and adequate contrast in both light and dark themes. |
| **NFR-16** | User-facing strings are externalisable, and date/number formatting is locale-aware. One currency per tenant (C-01). |

### 2.4.8 Maintainability and Verification *[reconstructed]*

| ID | Requirement |
|---|---|
| **NFR-17** | Access control, tenant isolation, and financial rules carry automated tests that fail on regression. Isolation and permission tests are not optional coverage. |
| **NFR-18** | Where a taxonomy is duplicated across the frontend and backend, a contract test asserts the two agree, so drift fails a test rather than reaching production. *[pinned — `module-taxonomy.contract.spec.ts`, DEBT-016]* |

## 2.5 Requirement Status Vocabulary

| Status | Meaning |
|---|---|
| **Specified** | Stated here completely enough to implement and verify. |
| **Provisional** | Real but coined in code; ratified by 2.6 without renumbering. |
| **Open** | Named by another document but never actually specified. `FR-BILL-02` is the significant case. |
| **Deferred** | Specified but out of v1 scope (e.g. per-line refund attribution). |

## 2.6 Traceability: Provisional → Canonical

Ratifies the `PROV-` identifiers still present in frontend code. **Numbers are preserved**, so existing comments remain accurate after the prefix is dropped.

| Provisional (in code) | Canonical | Where the code lives |
|---|---|---|
| `PROV-BR-03` | BR-06 *(SKU rule)* | `src/lib/validation/inventory.ts` |
| `PROV-BR-07` | BR-04 *(no negative stock)* | `src/lib/validation/inventory.ts` |
| `PROV-BR-08` | BR-07 *(integer quantities)* | `src/lib/validation/inventory.ts` |
| `PROV-FR-INV-02` | FR-INV-02 | `src/lib/validation/inventory.ts` |
| `PROV-FR-INV-04` | FR-INV-04 | `src/lib/validation/inventory.ts` |
| `PROV-FR-SALE-02` | FR-SALE-02 | `src/lib/validation/sales.ts` |
| `PROV-FR-SALE-03` | FR-SALE-03 | `src/lib/validation/sales.ts` |
| `PROV-FR-SALE-05` | FR-SALE-05 *(deferred portion)* | Section 5.11 |
| `PROV-FR-PUR-02` | FR-PUR-02 | `src/lib/validation/purchases.ts` |
| `PROV-FR-PUR-03` | FR-PUR-03 | `src/lib/mock-data/purchase-orders.ts` |
| `PROV-FR-PUR-04` | FR-PUR-04 | `src/lib/validation/purchases.ts` |
| `PROV-FR-PUR-05` | FR-PUR-05 | `src/lib/mock-data/purchase-orders.ts` |

**Note on the `PROV-BR-*` mapping:** the three provisional business-rule numbers do **not** line up with their canonical numbers, because `PROV-BR-03` (SKU) collides with the long-established BR-03 (financial immutability), which is cited in far more places and keeps the number. This is the one place ratification renumbers, and it is why the table above is required reading before editing those files.

## 2.7 Open Requirements

| ID | Gap | Blocks |
|---|---|---|
| **FR-BILL-02** | No proration rule exists at all. | Proration in `PATCH /billing/modules` (DEBT-018) |
| **FR-REP-03** | Export format and library undecided. | Reports export (DEBT-009) |
| **FR-CUST-03** | Customer/supplier ledger undecided. | DEBT-010 |
| *(pricing)* | No per-module add-on price; no invoice entity. | FR-BILL-02, Section 1.5.1 |
| *(packaging)* | Plan tiers differentiate on core modules, which cannot be enforced. | DEBT-020, Section 1.5.1 |

## 2.8 Documentation Debt

Addressed by this section:

| Item | Status in this section |
|---|---|
| DEBT-013 — Rate limit thresholds | **Resolved** for the Section 2 half: NFR-08 carries the thresholds and the proxy-trust posture. |
| DEBT-015 — Mail provider | **Resolved** for the requirement half: NFR-12 states the abstraction. Transport selection remains a product decision. |
| DEBT-017 — Undocumented middleware behaviour | **Partially addressed:** NFR-07 states deny-by-default, which is the fail-closed behaviour the guard implements. The chain's step ordering remains Section 6.2's to document. |

Deliberately **not** closed here:

| Item | Why |
|---|---|
| DEBT-018 — Proration | FR-BILL-02 is recorded as **open**, not invented. Writing a rounding rule without a product decision would create a false spec. |
| DEBT-007 — Custom roles | FR-SET-02 states the requirement; the type-system work is Section 6/9. |
