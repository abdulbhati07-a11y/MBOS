# Section 4: System Architecture

> **Document status:** Draft — written against the frontend build completed in Steps 1–12.  
> Where the frontend build produced decisions that differ from or refine earlier SRS drafts, this section documents the real decision with a cross-reference to the relevant `DOCUMENTATION_DEBT.md` entry.

---

## 4.1 Architectural Style

MBOS is a **modular monolith** deployed as a single unit at launch. This decision was made in Section 1 and is restated here as the constraint that governs all architectural choices in this section.

**What "modular monolith" means concretely:**

- All modules (Inventory, Sales, Customers, Purchases, Reports, Settings, Industry Modules) are compiled and deployed together as one Next.js application (frontend) and one NestJS application (backend API).
- Module boundaries are enforced by convention and static analysis (NFR-10), not by process or network separation.
- There are no inter-module API calls at runtime — modules communicate through shared domain entities and application-layer interfaces within the same process.
- A migration path to microservices is explicitly kept open but not designed for. No service-discovery, message-broker, or distributed-tracing infrastructure is introduced at launch.

**Why not microservices at launch:** The multi-tenant billing model (Section 2 FR-BILL-*) requires per-module access control checked on every request. Implementing this correctly across distributed services at SME scale adds infrastructure overhead that is disproportionate to the problem. The modular monolith achieves the same module-boundary isolation at a fraction of the operational cost, and the boundaries established here are the same ones that would become service boundaries if a migration is ever warranted.

---

## 4.2 Layer Diagram and Responsibilities

MBOS follows Clean Architecture, with four layers ordered from outermost (closest to the user) to innermost (closest to the data):

```
┌─────────────────────────────────────────────────┐
│  PRESENTATION                                   │
│  Next.js App Router · React components          │
│  RoleProvider · useCanPerform · useModuleAccess │
├─────────────────────────────────────────────────┤
│  APPLICATION                                    │
│  NestJS service layer · Use cases               │
│  Business rule enforcement · Auth middleware    │
├─────────────────────────────────────────────────┤
│  DOMAIN                                         │
│  Core entities · Value objects · Domain events  │
│  Financial rules (NFR-14) · BR-01 through BR-10 │
├─────────────────────────────────────────────────┤
│  INFRASTRUCTURE                                 │
│  Prisma ORM · PostgreSQL · AI provider          │
│  File storage · Email                           │
└─────────────────────────────────────────────────┘
```

**Cross-cutting (between Presentation and Application):**  
Tenant isolation middleware and module-access middleware sit at this boundary. Every API request passes through both before reaching any Application-layer logic. This is where FR-TEN-04 and FR-BILL-03 are enforced — not in the Presentation layer.

### Layer responsibilities

**Presentation** is everything the frontend build produced: React components, the three shared contexts (`RoleProvider`, `ProductsContext`, `OrdersContext`), permission hooks (`useCanPerform`, `useModuleAccess`), and form validation (Zod schemas). The frontend build's RBAC system is a Presentation-layer approximation of what the Application layer must enforce for real. Switching the role source from `React.useState` to a JWT claim (DEBT-006) does not change the Presentation layer's shape — only the data it receives.

**Application** contains NestJS service classes, one per module, that orchestrate domain logic. This is where business rules that cannot live in the UI are enforced:
- The PO status transition map (`PO_TRANSITIONS`) must be re-validated here on every state-change request — not trusted from the client (DEBT-002)
- `Actions.REFUND` ≠ `Actions.DELETE` for Sales orders — a posted order cannot be mutated, only reversed. The domain rule is enforced here regardless of what the client sends (BR-03)
- Permission checks via the real `RolePermission` table — not the TypeScript constant

**Domain** contains the core entity definitions, value objects, and domain event declarations. The financial calculation rules (NFR-14) live here: monetary arithmetic uses a fixed-point library, never JavaScript's native floating-point. This layer has no dependency on Prisma, NestJS, or any external library other than the fixed-point arithmetic library.

**Infrastructure** contains the Prisma schema, repository implementations, and adapters for external services. The `AIProviderInterface` (Section 2.4.4) is declared in the Domain or Application layer and implemented here — no Application-layer code imports a specific AI vendor's SDK directly.

---

## 4.3 Multi-Tenant Data Architecture

MBOS uses a **single database with row-level tenant isolation**. Every core entity table has a `tenantId` column. The enforcement mechanism is a Prisma middleware interceptor that automatically appends `WHERE tenantId = :currentTenantId` to every query before it reaches the database.

### Tenancy enforcement chain

```
1. HTTP request arrives
2. Auth middleware: validates JWT, extracts tenantId + userId + role
3. Tenant context is stored in AsyncLocalStorage (available to all downstream code in this request)
4. Prisma middleware: reads tenantId from AsyncLocalStorage, injects into every query
5. Application layer: runs with tenantId-filtered queries only
6. No query reaches PostgreSQL without the tenantId filter
```

**Why AsyncLocalStorage:** It avoids threading the tenant context through every function signature, while remaining explicit about the scope (per-request, not global). Each request is isolated; there is no cross-contamination between tenant contexts within the same process.

**What is never acceptable:**
- Accepting `tenantId` as a request body or query parameter — tenant context comes only from the validated JWT
- Bypassing the Prisma middleware for any reason — even "admin" queries must go through it unless they are explicitly scoped to a separate admin connection with its own access controls
- UI-level tenant filtering as a substitute for database-level filtering (FR-TEN-04)

### Tenant provisioning

When a new tenant is created, a `Tenant` record is inserted. No schema migration is required — the single-database model means all tenants share the same schema. Tenant isolation is enforced exclusively by the tenantId filter.

---

## 4.4 Module Boundary Enforcement

The principle from Section 1 — "Industry Modules are thin layers over shared core entities" — is formalized here.

### What a module owns

Each module owns:
- Its own NestJS module file (`*.module.ts`)
- Its own service layer (`*.service.ts`) containing use cases scoped to that module
- Its own controller/route handlers (`*.controller.ts`)
- Its own DTOs (request/response shapes)
- Its own Zod validation schemas (mirroring the frontend's `src/lib/validation/` pattern)

Each module shares (via the Domain and Infrastructure layers):
- Core entities: `Tenant`, `User`, `Product`, `Order`, `Customer`, `Supplier`, `PurchaseOrder`
- The tenantId-filtered Prisma repository base class
- Domain events (for loose coupling between modules where needed)

### What is prohibited (NFR-10)

```typescript
// ❌ FORBIDDEN — Module A importing Module B's service
import { SalesService } from '../sales/sales.service'

// ✅ CORRECT — Module A uses a shared domain entity via its own repository
import { OrderRepository } from '../shared/repositories/order.repository'

// ✅ CORRECT — Module A reacts to a domain event emitted by Module B
@OnEvent('order.placed')
handleOrderPlaced(event: OrderPlacedEvent) { ... }
```

The prohibition on cross-module service imports is enforced by an ESLint architecture rule that flags any import where the import path crosses a module boundary at the service layer. Violations are build-time errors.

### How Industry Modules attach

An Industry Module (Clinic, Pharmacy, Restaurant) is a standard NestJS module that:

1. Declares itself as optional by registering with the `ModuleSubscriptionService`
2. Can extend core entities by adding its own related entities (e.g. `Patient` with a FK to `Customer`) — it cannot modify the core entity itself
3. Cannot import services from Core modules — it reacts to domain events instead
4. Is gated by the tenant's subscription at the middleware layer (FR-BILL-03, UC-04): enabling a module takes effect on the next request, not on the next deployment

The frontend's `Modules.CLINIC` permission matrix entry is the Presentation-layer gate. The real gate is the middleware checking the `TenantModuleSubscription` table.

---

## 4.5 Authentication and Authorization Architecture

Authentication (identity) and authorization (access) are separate concerns with separate implementations.

### Authentication

**Mechanism:** JWT-based. Two-token model:
- Short-lived access token (15 minutes) containing `tenantId`, `userId`, `role`
- Long-lived refresh token (7 days) stored as an `httpOnly` cookie, rotated on use

**Role derivation:** The `role` claim in the JWT is the source of truth for the current user's role. This is what DEBT-006 points at: `RoleProvider.initialRole` in the frontend will be set from the JWT `role` claim when the real auth integration is built. The context shape (`Role`, `canPerform(module, action)`) requires no changes — only the data source changes from `React.useState` to the JWT claim.

**Multi-factor authentication:** The frontend's `/mfa` route is the Presentation-layer entry point. The Application layer enforces MFA completion before issuing a full-access JWT.

### Authorization

**Role-based permission checks:**

The frontend's `DEFAULT_ROLE_PERMISSIONS` TypeScript constant becomes seed data for a `RolePermission` table in the database:

```
RolePermission {
  id:       UUID
  tenantId: UUID  -- FK to Tenant (custom roles are tenant-scoped)
  role:     String
  module:   String  -- matches Modules enum values
  action:   String  -- matches Actions enum values
  granted:  Boolean
}
```

The three built-in roles (Owner, Manager, Cashier) are seeded for every new tenant from `DEFAULT_ROLE_PERMISSIONS`. They cannot be deleted, only extended.

`canPerform(module, action)` in the Application layer queries this table for the current user's role on the current tenant. The TypeScript constant is the frontend's optimistic cache of this data for the current session.

**Custom roles (DEBT-007 resolution path):**

The `Role` type in the frontend is currently `"Owner" | "Manager" | "Cashier"` — a closed union. Extending this requires:
1. Widening `Role` to `string` in the frontend (or extending the union with a generic `string` fallback)
2. `canPerform` in the Application layer queries the `RolePermission` table, not the static constant
3. A Settings UI (FR-SET-02) allowing tenant admins to create custom roles and assign permission sets

This is a Section 6 design decision, not a Section 4 one. Section 4 establishes that the data model supports it; Section 6 designs the API endpoints.

**Module access middleware (FR-BILL-03):**

A separate middleware, running before the permission check, queries `TenantModuleSubscription` to determine whether the requested module is enabled for the current tenant. If not enabled, the request is rejected with 403 before reaching the Application layer. This is the server-side enforcement of what `useModuleAccess()` previews in the frontend.

The middleware is distinct from the permission check: a module can be enabled for a tenant (subscription) but a specific user can still lack permission to access it (RBAC). Both must pass.

---

## 4.6 Financial Calculation Rules

These rules are stated here because they are architectural constraints that every layer — Domain, Application, Infrastructure, and Presentation — must respect independently. UI-level enforcement (the `toFixed(2)` pattern in the frontend build) is not a substitute for domain-level enforcement.

### Storage

All monetary values are stored as **integers representing the smallest currency unit** (cents for USD, pence for GBP, etc.) in PostgreSQL. No `FLOAT`, `REAL`, or `NUMERIC` columns for monetary values — `INTEGER` only.

```sql
-- ✅ CORRECT
price_cents    INTEGER NOT NULL  -- 2999 = $29.99
tax_amount_cents INTEGER NOT NULL

-- ❌ FORBIDDEN
price          DECIMAL(10,2)  -- floating-point representation issues
total          FLOAT           -- never for money
```

**Current frontend gap (DEBT-012):** The frontend mock data stores monetary values as JavaScript floats (e.g. `price: 29.99`). When the real API is connected, these become integers in cents (`price: 2999`), and every `toFixed(2)` call site must change to `(value / 100).toFixed(2)`. This is a systematic, mechanical migration — all monetary display in all modules is affected.

### Arithmetic

All monetary arithmetic in the Application and Domain layers uses a fixed-point arithmetic library (e.g. `dinero.js` or equivalent). JavaScript's native `*`, `+`, `/` operators are never used on monetary values in business logic.

### Display

`toFixed(2)` is a **Presentation-layer concern only**. It formats a computed floating-point result for display. It does not fix the underlying value — applying `toFixed(2)` to a stored float and saving the result back would corrupt the data. The frontend build's consistent use of `toFixed(2)` at all display sites is correct for the current mock-data phase.

### Immutability (BR-03)

No UPDATE or DELETE on any posted financial transaction record (Order, PurchaseOrder, Invoice). Corrections are new reversing entries — a refund creates a new Refund record linked to the original Order, it does not modify the Order row.

This is what `Actions.REFUND` ≠ `Actions.DELETE` in the permission matrix was independently enforcing at the UI level. The Application layer enforces the same rule on the write path regardless of what the client sends: any request that attempts to UPDATE an Order record's financial fields after it has been posted will be rejected at the service layer, not at the controller.

---

## 4.7 AI Provider Abstraction

The `AIProviderInterface` is declared in the Application layer and injected into any service that needs AI capabilities. No service imports a vendor SDK directly.

```typescript
// Domain / Application layer
interface AIProviderInterface {
  generateInsights(context: BusinessContext): Promise<InsightResult[]>
  generateSuggestion(prompt: string): Promise<string>
  // ... other capabilities as needed
}

// Infrastructure layer — one implementation per vendor
class OpenAIProvider implements AIProviderInterface { ... }
class AnthropicProvider implements AIProviderInterface { ... }
```

The abstraction achieves two things:
1. **Vendor portability** — swapping providers is an Infrastructure change, not an Application change
2. **Testability** — Application-layer tests use a mock implementation; no API calls are made in tests

The frontend's `// TODO: FR-AI-03` comments (Dashboard Health Score, Reports AI Insights) mark the Presentation-layer entry points. The full feature requires this interface to be implemented and wired — the frontend stubs are correctly deferred.

---

## 4.8 Deployment Architecture

This section describes the initial launch deployment topology. It is intentionally brief — detailed infrastructure design is Section 10.

**Frontend:** Next.js application deployed to Vercel (static generation where possible, serverless functions for API routes). Consistent with C-03 (Vercel named as primary frontend host).

**Backend API:** NestJS application deployed as a container (Docker) on a managed platform. Consistent with C-03 (DigitalOcean or Hetzner-hosted, not hyperscaler-only). No Kubernetes or container orchestration at launch — a single container instance behind a reverse proxy is sufficient for initial SME scale.

**Database:** PostgreSQL on a managed database instance (e.g. DigitalOcean Managed Databases or Hetzner-hosted PostgreSQL). Not embedded, not self-managed. Automated backups and point-in-time recovery required from day one.

**Local development:** Docker Compose providing PostgreSQL and any required backing services. The Next.js and NestJS processes run outside Docker in development for fast reloads.

**No shared state between frontend and backend processes** other than the API contract — the frontend's React contexts (`RoleProvider`, `ProductsContext`, `OrdersContext`) are purely client-side state. They are replaced by API calls in production; the context boundaries established in the frontend build map directly onto the API endpoints that will replace them.

---

## 4.9 Cross-References to Documentation Debt

The following debt items are addressed or resolved by this section:

| Item | Status in this section |
|---|---|
| DEBT-002 — PO state machine must be server-enforced | Section 4.2 (Application layer): transition rules re-validated server-side; client enforcement is UX only |
| DEBT-006 — RoleProvider is client-only | Section 4.5: JWT `role` claim → `RoleProvider.initialRole` path described |
| DEBT-007 — Custom roles require type system changes | Section 4.5: `RolePermission` table path described; Section 6 designs the API |
| DEBT-008 — Company profile tax rate not wired | Section 4.2: Settings values are Application-layer configuration, fetched via API at session start |
| DEBT-012 — Float monetary values in mock data | Section 4.6: migration path documented (integer cents in DB, `value / 100` in Presentation layer) |

Items not addressed here (genuinely deferred to other sections):

| Item | Target section |
|---|---|
| DEBT-001 — Password complexity rules | Section 3 (update) |
| DEBT-003 — Deactivated supplier name on POs | Section 9 (Purchases spec) |
| DEBT-004 — Customer FK in Orders | Section 5 (ERD) + Section 6 (API) |
| DEBT-005 — Supplier category taxonomy | Section 9 (Purchases spec) |
| DEBT-009 — Reports export | Section 6 (API) + library decision |
| DEBT-010 — Customer/Supplier ledger | Section 6 (API) + Section 8/9 (module specs) |
| DEBT-011 — MOCK_ORDERS static (resolved in code) | Section 6 (API) replaces the context entirely |
