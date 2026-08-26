# Section 5: Database Design

> **Document status:** Draft — written against the frontend build (Steps 1–12) and the three schema decisions confirmed before this section was written:
> - **D-01:** One User belongs to exactly one Tenant (FK on User, not a join table)
> - **D-02:** Built-in roles (Owner/Manager/Cashier) are global (`tenantId IS NULL`); custom roles are tenant-scoped
> - **D-03:** `TenantModuleSubscription` is the sole access-control authority; Plans are billing/onboarding convenience only

---

## 5.1 Design Principles

Every table in this section follows these constraints without exception.

**Monetary values** are stored as `INTEGER` (smallest currency unit — paisa for the default `PKR`, cents for `USD`, pence for `GBP`). No `FLOAT`, `REAL`, or `DECIMAL` columns for money. Display formatting is a Presentation-layer concern and goes through `src/lib/format/currency.ts` — not an inline `(value / 100).toFixed(2)`, which reintroduces float arithmetic on exact amounts one call site at a time. See Section 4.6 and DEBT-012.

**Primary keys** are UUIDs (`UUID` type in PostgreSQL). No serial/auto-increment integers for any entity that will cross a tenant boundary or appear in a URL.

**Tenant isolation** is enforced by a `tenantId UUID NOT NULL` column on every core entity table, filtered by Prisma middleware on every query (Section 4.3). Tables marked *global* below are the only exceptions — they are shared across all tenants by design.

**Soft deletes** via `deletedAt TIMESTAMPTZ` (nullable) on any entity that can be referenced by a financial record. Hard deletes are prohibited on those tables (BR-03). Prisma middleware appends `WHERE deletedAt IS NULL` to all queries by default.

**Timestamps:** `createdAt TIMESTAMPTZ NOT NULL DEFAULT now()` and `updatedAt TIMESTAMPTZ NOT NULL` on every table. `updatedAt` is maintained by a Prisma `$beforeWrite` middleware, not application code.

**Snapshots:** Denormalized copies of mutable reference data on financial records (e.g. `productNameSnapshot` on `OrderLine`). Financial records must be self-describing; joining back to a mutable source table would allow history to silently change if the source is renamed or deleted.

**Naming conventions:**
- Monetary columns: `*Cents` suffix (`INTEGER NOT NULL`)
- Snapshot columns: `*Snapshot` suffix
- Soft-delete: `deletedAt TIMESTAMPTZ` (nullable — `NULL` = active)
- Boolean active/enabled flags: `isActive BOOLEAN NOT NULL DEFAULT true`
- Basis points for rates: `*Bps` suffix (`INTEGER NOT NULL` — 800 = 8.00%)

---

## 5.2 Identity and Tenancy Group

### Tenant *(global — no tenantId)*

The billing and isolation root. Every other entity traces back to a Tenant row.

```
Tenant
  id          UUID PK DEFAULT gen_random_uuid()
  name        TEXT NOT NULL
  slug        TEXT NOT NULL UNIQUE   -- URL-safe identifier, e.g. "acme-corp"
  status      TEXT NOT NULL DEFAULT 'Active'
              CHECK (status IN ('Active', 'Suspended', 'Cancelled'))
  createdAt   TIMESTAMPTZ NOT NULL DEFAULT now()
  updatedAt   TIMESTAMPTZ NOT NULL
  deletedAt   TIMESTAMPTZ
```

### TenantSettings *(1:1 extension of Tenant — resolves DEBT-008)*

Tenant-specific configuration. `defaultTaxRateBps` is the value `NewOrderForm` pre-fills at session start; `Order.taxRateBps` is the snapshot of what was actually applied to a specific order and is never changed by updating TenantSettings.

`currencyCode` uses ISO 4217 (e.g. `PKR`, `USD`, `GBP`) rather than a currency symbol. The display symbol must not be stored directly — doing so would couple multi-currency formatting to a free-text field. It defaults to `PKR`, the product's market; PKR's minor unit is the paisa (1/100 rupee), which is what every `*Cents` column then holds. Note that `Intl.NumberFormat` with `style: "currency"` renders PKR as "Rs", "₨" or "PKR" depending on the ICU build, so the frontend derives the symbol from a constant rather than from ICU — see `src/lib/format/currency.ts`.

Changing `currencyCode` on a tenant that already has financial rows reinterprets them rather than converting them, and BR-03 forbids editing the affected records afterwards. There is no conversion endpoint in Section 6. See DEBT-024.

```
TenantSettings
  tenantId          UUID PK FK → Tenant.id ON DELETE CASCADE
  companyName       TEXT NOT NULL DEFAULT ''
  defaultTaxRateBps INTEGER NOT NULL DEFAULT 0
  currencyCode      CHAR(3) NOT NULL DEFAULT 'PKR'
  timezone          TEXT NOT NULL DEFAULT 'UTC'
  updatedAt         TIMESTAMPTZ NOT NULL
```

### Branch *(tenant-scoped — resolves FR-TEN-02/03)*

The multi-location entity. The AppShell's Branch Switcher stub (renamed from "Tenant Switcher" at commit 6b72ea4) is backed by this table. Every Order and StockAdjustment can be attributed to a branch, enabling the branch-level filtering that FR-REP-02 requires and which the Reports module had to mark as blocked due to the absent field.

```
Branch
  id          UUID PK DEFAULT gen_random_uuid()
  tenantId    UUID NOT NULL FK → Tenant.id
  name        TEXT NOT NULL
  address     TEXT NOT NULL DEFAULT ''
  isDefault   BOOLEAN NOT NULL DEFAULT false
  isActive    BOOLEAN NOT NULL DEFAULT true
  createdAt   TIMESTAMPTZ NOT NULL DEFAULT now()
  updatedAt   TIMESTAMPTZ NOT NULL
```

*Constraint:* Exactly one branch per tenant has `isDefault = true`. Enforced by a partial unique index: `CREATE UNIQUE INDEX ON Branch (tenantId) WHERE isDefault = true`.

### User *(tenant-scoped — D-01: one user, one tenant)*

One user belongs to exactly one tenant. Email is unique within a tenant, not globally — the same email address can register with two different tenants as separate accounts. `role` is a FK to the `Role` table (see 5.3).

```
User
  id            UUID PK DEFAULT gen_random_uuid()
  tenantId      UUID NOT NULL FK → Tenant.id
  email         TEXT NOT NULL
  passwordHash  TEXT NOT NULL   -- bcrypt; complexity rules enforced at
                                -- application layer before writing (DEBT-001)
  roleId        UUID NOT NULL FK → Role.id
  isActive      BOOLEAN NOT NULL DEFAULT true
  mfaEnabled    BOOLEAN NOT NULL DEFAULT false
  mfaSecret     TEXT             -- null until MFA is enrolled
  createdAt     TIMESTAMPTZ NOT NULL DEFAULT now()
  updatedAt     TIMESTAMPTZ NOT NULL
  deletedAt     TIMESTAMPTZ

  UNIQUE (tenantId, email)
```

### RefreshToken *(tenant-scoped)*

Supports JWT refresh token rotation. Tokens are hashed before storage; the raw token is never persisted. `revokedAt` is set when a token is consumed (single-use rotation) or explicitly invalidated.

```
RefreshToken
  id          UUID PK DEFAULT gen_random_uuid()
  userId      UUID NOT NULL FK → User.id ON DELETE CASCADE
  tokenHash   TEXT NOT NULL UNIQUE
  expiresAt   TIMESTAMPTZ NOT NULL
  revokedAt   TIMESTAMPTZ           -- null = still valid
  createdAt   TIMESTAMPTZ NOT NULL DEFAULT now()
```

---

## 5.3 Access Control Group

### Role *(global for built-ins, tenant-scoped for custom — D-02)*

Three rows are seeded at database initialisation with `tenantId IS NULL` and `isBuiltIn = true`. These rows are never deleted. Custom roles created by tenant admins (FR-SET-02, DEBT-007) have a real `tenantId` and `isBuiltIn = false`.

```
Role
  id          UUID PK DEFAULT gen_random_uuid()
  tenantId    UUID FK → Tenant.id   -- NULL for built-in roles (Owner/Manager/Cashier)
  name        TEXT NOT NULL
  isBuiltIn   BOOLEAN NOT NULL DEFAULT false
  createdAt   TIMESTAMPTZ NOT NULL DEFAULT now()

  UNIQUE (tenantId, name)   -- allows NULL tenantId (global) + same name across tenants
```

### RolePermission *(global for built-in role permissions)*

The backend equivalent of `DEFAULT_ROLE_PERMISSIONS` from the frontend. Seeded at initialisation for the three built-in roles. Custom role permissions are inserted when a tenant creates a custom role.

`module` and `action` values match the `Modules` and `Actions` TypeScript enums exactly — enforced by application-layer validation, not a database foreign key.

```
RolePermission
  id        UUID PK DEFAULT gen_random_uuid()
  roleId    UUID NOT NULL FK → Role.id ON DELETE CASCADE
  module    TEXT NOT NULL   -- matches Modules enum: 'sales', 'inventory', etc.
  action    TEXT NOT NULL   -- matches Actions enum: 'read', 'write', 'delete', 'refund'
  granted   BOOLEAN NOT NULL DEFAULT true

  UNIQUE (roleId, module, action)
```

### TenantModuleSubscription *(tenant-scoped — D-03, FR-BILL-03)*

The sole access-control authority for module access. The middleware reads this table on every API request — it never reads from `Plan` or `PlanModule`. Enabling a module inserts a row (or sets `disabledAt = NULL` on an existing row); disabling sets `disabledAt = now()`.

```
TenantModuleSubscription
  id          UUID PK DEFAULT gen_random_uuid()
  tenantId    UUID NOT NULL FK → Tenant.id
  moduleKey   TEXT NOT NULL   -- matches Modules enum
  enabledAt   TIMESTAMPTZ NOT NULL DEFAULT now()
  disabledAt  TIMESTAMPTZ     -- null = currently enabled

  UNIQUE (tenantId, moduleKey)
```

### Plan *(global — billing/onboarding convenience only)*

Defines pricing tiers. Never read by the access-control middleware. Selecting a plan at onboarding pre-populates `TenantModuleSubscription` rows but has no ongoing relationship to access control.

```
Plan
  id              UUID PK DEFAULT gen_random_uuid()
  name            TEXT NOT NULL UNIQUE
  description     TEXT NOT NULL DEFAULT ''
  priceMonthly    INTEGER NOT NULL   -- minor units (paisa for PKR)
  priceAnnual     INTEGER NOT NULL   -- minor units (paisa for PKR)
  isActive        BOOLEAN NOT NULL DEFAULT true
  createdAt       TIMESTAMPTZ NOT NULL DEFAULT now()
  updatedAt       TIMESTAMPTZ NOT NULL
```

### PlanModule *(global — billing only)*

Which modules are included in a plan. Used only at subscription provisioning time to seed `TenantModuleSubscription`. Never queried at request time.

```
PlanModule
  id          UUID PK DEFAULT gen_random_uuid()
  planId      UUID NOT NULL FK → Plan.id ON DELETE CASCADE
  moduleKey   TEXT NOT NULL

  UNIQUE (planId, moduleKey)
```

### TenantSubscription *(tenant-scoped — billing record)*

Tracks which plan a tenant is currently on, for billing and invoicing purposes. Has no effect on module access — that is `TenantModuleSubscription`'s responsibility.

```
TenantSubscription
  id                  UUID PK DEFAULT gen_random_uuid()
  tenantId            UUID NOT NULL FK → Tenant.id
  planId              UUID NOT NULL FK → Plan.id
  status              TEXT NOT NULL
                      CHECK (status IN ('Active', 'PastDue', 'Cancelled', 'Trialing'))
  currentPeriodStart  TIMESTAMPTZ NOT NULL
  currentPeriodEnd    TIMESTAMPTZ NOT NULL
  cancelledAt         TIMESTAMPTZ
  createdAt           TIMESTAMPTZ NOT NULL DEFAULT now()
  updatedAt           TIMESTAMPTZ NOT NULL
```

---

## 5.4 Core Business Entities Group

### Customer *(tenant-scoped)*

Maps to `CustomerRecord` from the frontend. Email is unique within a tenant. `Order.customerId` is a FK to this table — the name-string matching used in the frontend mock data (DEBT-004) is replaced by this FK in production.

```
Customer
  id          UUID PK DEFAULT gen_random_uuid()
  tenantId    UUID NOT NULL FK → Tenant.id
  name        TEXT NOT NULL
  email       TEXT NOT NULL
  phone       TEXT NOT NULL DEFAULT ''
  address     TEXT NOT NULL DEFAULT ''
  notes       TEXT NOT NULL DEFAULT ''
  isActive    BOOLEAN NOT NULL DEFAULT true
  createdAt   TIMESTAMPTZ NOT NULL DEFAULT now()
  updatedAt   TIMESTAMPTZ NOT NULL
  deletedAt   TIMESTAMPTZ

  UNIQUE (tenantId, email)
```

### Supplier *(tenant-scoped)*

Maps to `SupplierRecord`. `categories` remains a text field in v1 — a proper taxonomy is a future schema migration (DEBT-005). Email is unique within a tenant. Soft-deleted rather than hard-deleted because `PurchaseOrder.supplierId` references this table.

```
Supplier
  id              UUID PK DEFAULT gen_random_uuid()
  tenantId        UUID NOT NULL FK → Tenant.id
  name            TEXT NOT NULL
  contactPerson   TEXT NOT NULL DEFAULT ''
  email           TEXT NOT NULL
  phone           TEXT NOT NULL DEFAULT ''
  address         TEXT NOT NULL DEFAULT ''
  categories      TEXT NOT NULL DEFAULT ''   -- free-text, comma-separated (DEBT-005)
  notes           TEXT NOT NULL DEFAULT ''
  isActive        BOOLEAN NOT NULL DEFAULT true
  createdAt       TIMESTAMPTZ NOT NULL DEFAULT now()
  updatedAt       TIMESTAMPTZ NOT NULL
  deletedAt       TIMESTAMPTZ

  UNIQUE (tenantId, email)
```

### Product *(tenant-scoped)*

Maps to `ProductRecord`. Monetary columns use the `*Cents` convention (DEBT-012). SKU is unique within a tenant. Soft-deleted to preserve `OrderLine` and `POLine` history.

```
Product
  id              UUID PK DEFAULT gen_random_uuid()
  tenantId        UUID NOT NULL FK → Tenant.id
  name            TEXT NOT NULL
  sku             TEXT NOT NULL
  category        TEXT NOT NULL DEFAULT ''
  priceCents      INTEGER NOT NULL DEFAULT 0
  costCents       INTEGER NOT NULL DEFAULT 0
  stock           INTEGER NOT NULL DEFAULT 0
  reorderPoint    INTEGER NOT NULL DEFAULT 0
  uom             TEXT NOT NULL DEFAULT 'piece'
  isActive        BOOLEAN NOT NULL DEFAULT true
  createdAt       TIMESTAMPTZ NOT NULL DEFAULT now()
  updatedAt       TIMESTAMPTZ NOT NULL
  deletedAt       TIMESTAMPTZ

  UNIQUE (tenantId, sku)
```

---

## 5.5 Sales / Orders Group

### Order *(tenant-scoped)*

Maps to `OrderRecord`. `customerId` is nullable for walk-in orders without a linked Customer record (DEBT-004 partial — nullable in v1, the target is non-nullable). `branchId` enables the branch-level reporting that FR-REP-02 requires and which the frontend Reports module had to mark as blocked.

Financial columns are all `*Cents` (DEBT-012). `taxRateBps` is a snapshot of the rate applied at order creation — independent of `TenantSettings.defaultTaxRateBps`, which may change after the order is placed.

No client may UPDATE the financial columns (`subtotalCents`, `taxAmountCents`, `totalCents`) after `status = 'Completed'`. This is enforced at the application service layer (BR-03), not by a database constraint — the service rejects the request before issuing a Prisma `update`.

```
Order
  id                UUID PK DEFAULT gen_random_uuid()
  tenantId          UUID NOT NULL FK → Tenant.id
  branchId          UUID NOT NULL FK → Branch.id
  orderNumber       TEXT NOT NULL               -- human-readable, e.g. "#1001"
  date              TIMESTAMPTZ NOT NULL DEFAULT now()
  customerId        UUID FK → Customer.id       -- nullable for walk-in orders
  paymentMethod     TEXT NOT NULL
                    CHECK (paymentMethod IN ('Cash', 'Card', 'Mobile'))
  status            TEXT NOT NULL DEFAULT 'Pending'
                    CHECK (status IN ('Pending', 'Completed', 'Refunded'))
  taxRateBps        INTEGER NOT NULL DEFAULT 0  -- snapshot; not affected by TenantSettings changes
  subtotalCents     INTEGER NOT NULL DEFAULT 0
  taxAmountCents    INTEGER NOT NULL DEFAULT 0
  totalCents        INTEGER NOT NULL DEFAULT 0
  createdAt         TIMESTAMPTZ NOT NULL DEFAULT now()
  updatedAt         TIMESTAMPTZ NOT NULL

  UNIQUE (tenantId, orderNumber)
```

**`Order.status` semantics:** `Refunded` means "at least one `RefundTransaction` exists for this order." It does not imply full refund. A fully-refunded state is derivable (`SUM(RefundTransaction.amountCents) >= Order.totalCents`) but is not a distinct status value in v1. `status` is set to `Refunded` by the application on the first `RefundTransaction` created — subsequent partial refunds add rows but do not change the status further.

### OrderLine *(tenant-scoped)*

`productNameSnapshot` is a denormalized copy of the product name at order creation time. Renaming a product does not alter order history. Same principle applied to `unitPriceCents` — the price at time of sale, not the current product price.

```
OrderLine
  id                    UUID PK DEFAULT gen_random_uuid()
  orderId               UUID NOT NULL FK → Order.id ON DELETE CASCADE
  productId             UUID NOT NULL FK → Product.id
  productNameSnapshot   TEXT NOT NULL   -- denormalized; immune to product rename
  unitPriceCents        INTEGER NOT NULL
  quantity              INTEGER NOT NULL CHECK (quantity > 0)
  lineTotalCents        INTEGER NOT NULL
```

### RefundTransaction *(tenant-scoped — BR-03 reversal record)*

The system of record for a refund. A refund is a new row here, never an UPDATE on `Order`. `Order.status` is updated as a side effect by the application after inserting this row — the only write path is `POST /orders/:id/refund`.

**v1 scope:** Refunds are order-level amount entries only. `amountCents` may be less than `Order.totalCents` (partial refund supported), but there is no FK to `OrderLine` — the schema does not track which specific line items were refunded. Per-line refund attribution requires inventory reversal logic (deferred alongside PROV-FR-SALE-05) and is a v2 concern.

Multiple `RefundTransaction` rows can exist for the same `orderId` (e.g. two separate partial returns). The one-to-many relationship is intentional.

```
RefundTransaction
  id                UUID PK DEFAULT gen_random_uuid()
  tenantId          UUID NOT NULL FK → Tenant.id
  orderId           UUID NOT NULL FK → Order.id
  amountCents       INTEGER NOT NULL CHECK (amountCents > 0)
  reason            TEXT NOT NULL DEFAULT ''
  createdByUserId   UUID NOT NULL FK → User.id
  createdAt         TIMESTAMPTZ NOT NULL DEFAULT now()
```

---

## 5.6 Purchases Group

### PurchaseOrder *(tenant-scoped)*

Maps to `PurchaseOrderRecord`. `supplierId` is a real FK — replacing the `supplierName` string-match used in the frontend (PROV-FR-PUR-03). `supplierNameSnapshot` is a denormalized copy of the supplier name at PO creation time, so that deactivating or renaming a supplier does not corrupt PO history (DEBT-003).

```
PurchaseOrder
  id                      UUID PK DEFAULT gen_random_uuid()
  tenantId                UUID NOT NULL FK → Tenant.id
  poNumber                TEXT NOT NULL
  date                    TIMESTAMPTZ NOT NULL DEFAULT now()
  supplierId              UUID NOT NULL FK → Supplier.id
  supplierNameSnapshot    TEXT NOT NULL   -- denormalized; immune to supplier rename/deactivation
  status                  TEXT NOT NULL DEFAULT 'Draft'
                          CHECK (status IN ('Draft', 'Sent', 'Received', 'Cancelled'))
  subtotalCents           INTEGER NOT NULL DEFAULT 0
  totalCents              INTEGER NOT NULL DEFAULT 0
  notes                   TEXT NOT NULL DEFAULT ''
  createdAt               TIMESTAMPTZ NOT NULL DEFAULT now()
  updatedAt               TIMESTAMPTZ NOT NULL

  UNIQUE (tenantId, poNumber)
```

### POLine *(tenant-scoped)*

Same snapshot pattern as `OrderLine`. `unitCostCents` is the buyer-negotiated cost at PO creation — independent of `Product.costCents`, which may change.

```
POLine
  id                    UUID PK DEFAULT gen_random_uuid()
  purchaseOrderId       UUID NOT NULL FK → PurchaseOrder.id ON DELETE CASCADE
  productId             UUID NOT NULL FK → Product.id
  productNameSnapshot   TEXT NOT NULL
  unitCostCents         INTEGER NOT NULL
  quantity              INTEGER NOT NULL CHECK (quantity > 0)
  lineTotalCents        INTEGER NOT NULL
```

### POStatusTransition *(tenant-scoped — DEBT-002 server-side enforcement)*

Audit log for every PO status change. The application validates the requested transition against `PO_TRANSITIONS` rules before inserting this row and updating `PurchaseOrder.status`. A client cannot skip states (e.g. Draft → Received) because the service layer rejects any transition not present in the allowed-transitions map for the current status.

This table makes PO status history fully auditable — who changed what, from which state, and when.

```
POStatusTransition
  id                UUID PK DEFAULT gen_random_uuid()
  tenantId          UUID NOT NULL FK → Tenant.id
  purchaseOrderId   UUID NOT NULL FK → PurchaseOrder.id
  fromStatus        TEXT NOT NULL
  toStatus          TEXT NOT NULL
  changedByUserId   UUID NOT NULL FK → User.id
  changedAt         TIMESTAMPTZ NOT NULL DEFAULT now()
```

---

## 5.7 Inventory Group

### StockAdjustment *(tenant-scoped)*

Audit trail for every change to `Product.stock`. The current stock level is the authoritative value on `Product.stock`; `StockAdjustment` is the history that explains how it got there. `Product.stock` is updated atomically with the `StockAdjustment` insert in a single Prisma transaction.

`branchId` is included because stock is branch-specific in a multi-location setup (FR-TEN-03). In a single-branch tenant, it always references the default branch.

```
StockAdjustment
  id                UUID PK DEFAULT gen_random_uuid()
  tenantId          UUID NOT NULL FK → Tenant.id
  branchId          UUID NOT NULL FK → Branch.id
  productId         UUID NOT NULL FK → Product.id
  type              TEXT NOT NULL
                    CHECK (type IN ('ADD', 'REMOVE', 'COUNT'))
  quantityDelta     INTEGER NOT NULL   -- positive for ADD/COUNT increase; negative for REMOVE
  reasonCode        TEXT NOT NULL
                    CHECK (reasonCode IN ('Received', 'Damaged', 'Correction', 'Returned', 'Sale', 'PurchaseReceived'))
  newStockLevel     INTEGER NOT NULL   -- snapshot of Product.stock after this adjustment
  createdByUserId   UUID NOT NULL FK → User.id
  createdAt         TIMESTAMPTZ NOT NULL DEFAULT now()
```

*Note on `reasonCode`:* `Sale` and `PurchaseReceived` are added here for when the backend auto-creates adjustment records on Order completion and PO receipt respectively. These are system-generated entries; `Sale` is not available as a manual reason in the `StockAdjustmentDialog`.

---

## 5.8 Financial Ledger Group *(forward-looking — DEBT-010)*

The tables described in 5.4–5.7 contain no invoice, payment, or balance entity. Customer and Supplier financials are currently limited to spend summaries derivable from `Order` and `PurchaseOrder` totals.

A complete financial ledger requires at minimum:

- **`Invoice`** — linked to `Order` (sales invoice) or `PurchaseOrder` (purchase invoice), carrying due date, issue date, and status
- **`Payment`** — linked to `Invoice`, recording individual payment events with amount and method
- **`CreditNote`** — linked to `RefundTransaction`, the formal accounting document for a refund

These entities are not designed here. Section 8 (Customers module spec) and Section 9 (Purchases/Suppliers module spec) will scope them when the financial module is planned. The `RefundTransaction` table in 5.5 is a pre-condition for `CreditNote` — it already records the reversing event that a credit note documents.

---

## 5.9 Entity Relationship Diagram

Abbreviated ASCII ERD showing primary relationships. PK = primary key, FK = foreign key. Cardinality: `1` = one, `*` = many.

```
Tenant 1 ──── * Branch
Tenant 1 ──── 1 TenantSettings
Tenant 1 ──── * User
Tenant 1 ──── * TenantModuleSubscription
Tenant 1 ──── 1 TenantSubscription ──── 1 Plan ──── * PlanModule
Tenant 1 ──── * Customer
Tenant 1 ──── * Supplier
Tenant 1 ──── * Product

User * ──── 1 Role ──── * RolePermission

Order * ──── 1 Tenant
Order * ──── 1 Branch
Order * ──── 1 Customer  (nullable — walk-in)
Order 1 ──── * OrderLine ──── 1 Product
Order 1 ──── * RefundTransaction

PurchaseOrder * ──── 1 Tenant
PurchaseOrder * ──── 1 Supplier
PurchaseOrder 1 ──── * POLine ──── 1 Product
PurchaseOrder 1 ──── * POStatusTransition

StockAdjustment * ──── 1 Tenant
StockAdjustment * ──── 1 Branch
StockAdjustment * ──── 1 Product
StockAdjustment * ──── 1 User
```

---

## 5.10 Cross-References to Documentation Debt

The following debt items are addressed or resolved by this section:

| Item | Addressed in |
|---|---|
| DEBT-001 — Password complexity rules | 5.2 (`User.passwordHash` — rules enforced at application layer before writing) |
| DEBT-002 — PO state machine server-enforced | 5.6 (`POStatusTransition` — transition validated before insert; client cannot skip states) |
| DEBT-003 — Deactivated supplier name on POs | 5.6 (`PurchaseOrder.supplierNameSnapshot` — denormalized, immune to supplier changes) |
| DEBT-004 — Customer FK in Orders | 5.5 (`Order.customerId` — real FK in production; nullable only for walk-in) |
| DEBT-005 — Supplier category taxonomy | 5.4 (`Supplier.categories` — still text field; noted as future migration) |
| DEBT-008 — Company profile tax rate | 5.2 (`TenantSettings.defaultTaxRateBps` — stored value that API returns for POS pre-fill) |
| DEBT-010 — Customer/Supplier ledger | 5.8 (Invoice/Payment/CreditNote named but not designed; scoped to Sections 8/9) |
| DEBT-012 — Float monetary values | 5.4/5.5/5.6 (all monetary columns as `INTEGER` cents with `*Cents` suffix) |

Items not addressed here (genuinely deferred to other sections):

| Item | Target section |
|---|---|
| DEBT-006 — RoleProvider client-only | Section 6 (JWT auth endpoint) |
| DEBT-007 — Custom roles type system | Section 6 (roles API) — `Role` table in 5.3 supports it; API design is Section 6 |
| DEBT-009 — Reports export | Section 6 (API) + library decision |
| DEBT-011 — MOCK_ORDERS static (resolved in code) | Section 6 (Orders API replaces context entirely) |
