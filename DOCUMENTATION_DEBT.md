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

### DEBT-004 — Customer order history uses name-string match, not FK

**Where it needs to land:** Section 8 (Core Modules Part A — Customers) and Section 6 (API Design, customer-order relationship)

**What needs to be written:** The customer↔order relationship requires a customer ID foreign key in the Orders schema. Currently `MOCK_ORDERS.customerName` is matched by string equality against `CustomerRecord.name`. Two customers with the same name would collide. The Customers detail view, order history tab, and any customer-level reporting depend on this being a real FK relationship in the backend.

**Source:** `src/components/customers/CustomerDetailDialog.tsx` — TODO comment on the filter. `src/lib/mock-data/customers.ts` — `getCustomerStats` helper comment. Identified during Step 6 review.

**Status:** Open

---

### DEBT-005 — Supplier categories are free-text with no taxonomy enforcement

**Where it needs to land:** Section 9 (Purchases module spec) and Section 2 (Inventory module spec, product categories)

**What needs to be written:** Whether product categories and supplier categories should share a common taxonomy (enum or lookup table), and if so, what enforces that relationship. Currently `SupplierRecord.categories` is a free-text comma-separated string. Values happen to mirror `MOCK_PRODUCTS` category names by convention but there is no enforced relationship.

**Source:** `src/lib/mock-data/suppliers.ts` — categories field comment. Identified during Step 7 planning.

**Status:** Open

---

## Resolved Items

*(None yet — items move here when the corresponding SRS section is written and reviewed.)*
