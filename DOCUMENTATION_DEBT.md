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

*(None yet — items move here when the corresponding SRS section is written and reviewed.)*
