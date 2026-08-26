# Section 6: API Design

> **Document status:** Draft — written against Sections 4 and 5 (committed at 87d746c and f225c75) and the frontend build (Steps 1–12).  
> Rate limit thresholds are TBD pending product decision — see DEBT-013.  
> AI endpoints are out of scope — see Section 7.

---

## 6.1 REST Conventions

### URL Structure

All endpoints are prefixed `/api/v1/`. URL versioning is used exclusively — no version negotiation via `Accept` or custom headers. A `/api/v2/` prefix is reserved for breaking changes; v1 endpoints remain stable while v2 is introduced alongside them.

```
/api/v1/{module}/{resource}
/api/v1/{module}/{resource}/{id}
/api/v1/{module}/{resource}/{id}/{sub-resource}
```

### Pagination

Every list endpoint returns the same envelope. The shape matches the frontend `DataTable` component's manual/server-side pagination contract exactly — `pageIndex` is 0-based, matching the component's existing `pageIndex` prop.

```json
{
  "data": [...],
  "pagination": {
    "pageIndex": 0,
    "pageSize": 10,
    "pageCount": 5,
    "total": 47
  }
}
```

List endpoints accept `?pageIndex=0&pageSize=10` as query parameters. Default `pageSize` is 10; maximum is 100. Requests with `pageSize > 100` return 400.

### Error Response Format

All errors use this shape regardless of HTTP status code:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable description",
    "details": [
      { "field": "email", "message": "Invalid email address" }
    ]
  }
}
```

`details` is only present on 422 Unprocessable Entity (validation failures). It is omitted on all other error codes.

**Standard status codes used:**

| Code | Meaning |
|---|---|
| 200 | OK |
| 201 | Created |
| 400 | Bad Request — malformed request body or query parameter |
| 401 | Unauthorized — missing or invalid JWT |
| 403 | Forbidden — valid JWT, insufficient permission or module not enabled |
| 404 | Not Found |
| 409 | Conflict — duplicate unique value or invalid state transition |
| 422 | Unprocessable Entity — body passes parsing but fails validation |
| 429 | Too Many Requests |
| 500 | Internal Server Error |

### Monetary Values

All monetary fields in request and response bodies are integers in the tenant currency's **minor units** — never floats (DEBT-012, Section 4.6). The tenant currency is `TenantSettings.currencyCode`, which defaults to `PKR`, so the minor unit is the paisa: `299900` is Rs 2,999.00. The field naming convention mirrors Section 5's `*Cents` suffix, which predates the currency choice and is a misnomer for PKR — see DEBT-023.

```json
{ "priceCents": 150000, "totalCents": 1350000 }
```

No monetary float values cross the API boundary in either direction. The frontend formats these through `formatMoneyMinor` in `src/lib/format/currency.ts`, which splits whole from fractional units with integer arithmetic — not by dividing by 100 and calling `.toFixed(2)`, which would put a float back on an amount that arrived exact. Writes convert with `parseMoneyToMinor`, on the digit string rather than via `Math.round(value * 100)`.

Values are capped at 2,147,483,647 (int4), or Rs 21,474,836.47. Exceeding it is a `422` naming the limit, not a `500` from the driver.

### Rate Limiting *(DEBT-013 — thresholds TBD)*

Rate limiting is enforced at the middleware layer (step 2 of the chain in 6.2) before authentication. Two separate limits apply:

**Authenticated requests (per tenant):** `X` requests per minute per `tenantId`, extracted from the JWT. Exceeding this returns `429` with a `Retry-After: <seconds>` header. *(Threshold TBD — DEBT-013.)*

**Unauthenticated auth endpoints** (`POST /auth/login`, `POST /auth/signup`): stricter per-IP limit to prevent credential-stuffing. *(Threshold TBD — DEBT-013.)*

**Burst allowance:** A short burst above the per-minute rate is permitted before throttling. *(Burst window and multiplier TBD — DEBT-013.)*

**429 response shape:**
```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests. Please retry after the indicated time.",
    "retryAfter": 30
  }
}
```

The `Retry-After` HTTP header is also set (as required by RFC 9110). The response body's `retryAfter` field duplicates it for clients that don't read headers.

---

## 6.2 Middleware Chain

Every API request passes through the following chain in order. Middleware failures short-circuit the chain — the route handler is never reached if any step fails.

```
Incoming HTTP request
  │
  ▼
1. CORS / Helmet
   Security headers (X-Frame-Options, HSTS, etc.), CORS origin validation.

  ▼
2. Rate Limiter
   Per-tenant (authenticated) or per-IP (unauthenticated). See 6.1.

  ▼
3. Auth Middleware
   Validates JWT signature and expiry.
   On success: extracts tenantId, userId, roleId, roleName → stores in AsyncLocalStorage.
   On failure: returns 401.
   Public endpoints (@Public decorator) skip steps 3–6.

  ▼
4. Tenant Isolation Middleware
   Reads tenantId from AsyncLocalStorage.
   Seeds the Prisma client context for this request.
   No query reaches the database without this filter (FR-TEN-04).

  ▼
5. Module Access Middleware
   Reads the requested module from the route metadata.
   Queries TenantModuleSubscription for (tenantId, moduleKey).
   If module is not enabled (disabledAt IS NOT NULL or row absent): returns 403.
   This enforces FR-BILL-03 — module access checked on every request, not just at login.

  ▼
6. Permission Middleware
   Reads the required (module, action) from the route metadata.
   Queries RolePermission for (roleId, module, action).
   If not granted: returns 403.
   Module access (step 5) and RBAC (step 6) are separate — both must pass.

  ▼
7. Route Handler / Controller
   NestJS controller method. Calls Application-layer service.

  ▼
8. Prisma Middleware (defence in depth)
   Injects WHERE tenantId = :currentTenant on every query.
   Even if steps 3–4 somehow failed, no cross-tenant data is returned.
```

**Key constraint:** Steps 5 and 6 are not the same check. A module can be enabled for a tenant but a specific user may still lack the required action permission. A user can have `sales.write` permission but if the Sales module is not in their tenant's subscription, they still get 403 at step 5.

---

## 6.3 Authentication Endpoints

All auth endpoints are `@Public` — they bypass the auth/permission middleware chain (steps 3–6 in 6.2). Rate limiting (step 2) still applies, with stricter per-IP limits on login and signup.

### POST /api/v1/auth/login

Validates email and password against the current tenant's User record.

**Request:**
```json
{ "email": "sana@acme.example.com", "password": "..." }
```

**Response (MFA not enrolled):** `200 OK`
```json
{
  "accessToken": "<jwt>",
  "expiresIn": 900
}
```
Refresh token is set as an `httpOnly`, `SameSite=Strict`, `Secure` cookie — never in the response body.

**Response (MFA enrolled):** `200 OK`
```json
{ "mfaRequired": true, "mfaSessionToken": "<short-lived token>" }
```
The `mfaSessionToken` is a limited-scope token used only for `POST /auth/mfa/verify`. It does not grant API access.

### POST /api/v1/auth/mfa/verify

Completes login when MFA is required.

**Request:**
```json
{ "mfaSessionToken": "<token>", "code": "123456" }
```

**Response:** `200 OK` — same shape as successful login above.

### POST /api/v1/auth/refresh

Reads the `httpOnly` refresh token cookie. Rotates the token (single-use) and returns a new access token. If the cookie is absent, expired, or revoked, returns `401`.

**Response:** `200 OK`
```json
{ "accessToken": "<jwt>", "expiresIn": 900 }
```

### POST /api/v1/auth/logout

Revokes the current refresh token (`revokedAt = now()`). Clears the cookie.

**Response:** `204 No Content`

### POST /api/v1/auth/password/forgot

Initiates email-based password reset. Always returns `200` regardless of whether the email exists (prevents email enumeration).

**Request:** `{ "email": "..." }`
**Response:** `200 OK` — no body

### POST /api/v1/auth/password/reset

Consumes a reset token and sets a new password. Password complexity is validated at the application layer per DEBT-001 rules.

**Request:** `{ "token": "...", "password": "..." }`
**Response:** `200 OK` — no body. Existing refresh tokens for this user are revoked as a side effect.

### GET /api/v1/auth/me *(resolves DEBT-006)*

Returns current user identity and role from the database — not decoded from the JWT. This is the endpoint the frontend calls on session start to seed `RoleProvider.initialRole`.

The DB-state lookup is deliberate: if an admin changes a user's role while their session is active, `GET /auth/me` returns the updated role immediately. A pure JWT-decode approach would return the stale role until the access token expires and is refreshed (up to 15 minutes of staleness).

**Response:** `200 OK`
```json
{
  "id": "user-uuid",
  "email": "sana@acme.example.com",
  "roleName": "Manager",
  "roleId": "role-uuid",
  "tenantId": "tenant-uuid",
  "mfaEnabled": true,
  "branchId": "branch-uuid",
  "branchName": "Main Branch"
}
```

**On `branchId` / `branchName`:** added during frontend integration, because Section 6.3 as originally written left the POS unable to operate. `POST /orders` (6.7) and `POST /inventory/adjustments` (6.8) both require a `branchId`, and the only endpoint listing branches is `GET /branches` (6.4), which requires `settings.read` — a permission the Cashier role does not hold. The one role whose entire job is ringing up sales therefore had no way to discover the branch every sale must be filed against.

It is returned here rather than defaulted inside `POST /orders` for two reasons: `/auth/me` is already the endpoint that answers "who am I and what may I do", and it is `@NoModuleRequired`, so this adds no permission surface. Keeping `branchId` **required** on the write endpoints means an order can never be silently filed against a branch nobody chose.

The value is the tenant's default branch — `isDefault` first, then oldest — restricted to branches that are active and not soft-deleted, since `isActive: false` exists precisely to stop new activity against a retired branch. It is `null` when the tenant has no usable branch; a client must surface that rather than substitute a guess, because a tenant in that state genuinely cannot record a sale. When per-user branch assignment lands (FR-TEN-03), this becomes the user's assigned branch and no caller changes.

**Performance note:** This endpoint is called once per session start, not on every page navigation. If it becomes a hot path (e.g., called on every SPA route change), a short TTL cache keyed on `userId` should be introduced at the application layer. This is not designed now — flagged for the implementation phase.

### JWT Claim Shape

Access tokens contain:
```json
{
  "sub": "user-uuid",
  "tenantId": "tenant-uuid",
  "roleId": "role-uuid",
  "roleName": "Manager",
  "iat": 1234567890,
  "exp": 1234568790
}
```

`roleName` maps directly to the frontend `Role` type. When custom roles are active (DEBT-007), `roleName` is any string — the frontend's `Role` type widens to `string` at that point. The frontend's `canPerform(module, action)` function already resolves permissions via `RolePermission` lookup, not by pattern-matching the role name string.

---

## 6.4 Tenant and Settings Endpoints *(resolves DEBT-008)*

All endpoints in this section require `settings.read` or `settings.write` as noted. `tenantId` is always derived from the JWT — never accepted from the request body.

### GET /api/v1/settings

Returns `TenantSettings` for the current tenant. Called at session start to pre-populate `CompanyProfileForm` and to set the default tax rate in `NewOrderForm` (resolving DEBT-008 — the frontend currently hardcodes `taxRate: 0`).

**Response:** `200 OK`
```json
{
  "companyName": "Acme Corp",
  "defaultTaxRateBps": 1700,
  "currencyCode": "PKR",
  "timezone": "Asia/Karachi"
}
```

`defaultTaxRateBps` is in basis points (1700 = 17.00%, Pakistan's standard GST rate). The frontend converts to percentage for display: `(defaultTaxRateBps / 100).toFixed(2) + '%'`.

Note that the shipped column defaults are `0` for `defaultTaxRateBps` and `UTC` for `timezone`, not the values shown above — a tax rate applied without the tenant having chosen it would land in records BR-03 forbids editing, and UTC is the storage default that also has to serve non-PK tenants. The example shows a configured tenant, not a fresh one.

### PATCH /api/v1/settings

Updates `TenantSettings`. Requires `settings.write`. Partial update — only supplied fields are changed.

**Request:** any subset of the settings fields. All monetary-adjacent fields (tax rate) use basis points.

### GET /api/v1/branches

Paginated list of branches for the current tenant.

### POST /api/v1/branches

Creates a branch. Requires `settings.write`. If `isDefault: true`, the existing default branch's `isDefault` is set to `false` atomically.

### PATCH /api/v1/branches/:id

Updates a branch. Requires `settings.write`.

### DELETE /api/v1/branches/:id

Soft-deletes a branch. Requires `settings.delete`. Returns `409` if any `Order` or `StockAdjustment` record references this branch — branches with financial history cannot be deleted, only deactivated (`isActive: false` via PATCH).

---

## 6.5 Access Control Endpoints *(resolves DEBT-006, DEBT-007)*

### GET /api/v1/roles

Returns all roles visible to the current tenant: global built-ins (`isBuiltIn: true, tenantId: null`) plus this tenant's custom roles.

**Response:** `200 OK`
```json
{
  "data": [
    { "id": "...", "name": "Owner", "isBuiltIn": true },
    { "id": "...", "name": "Manager", "isBuiltIn": true },
    { "id": "...", "name": "Cashier", "isBuiltIn": true }
  ],
  "pagination": { ... }
}
```

### POST /api/v1/roles

Creates a custom role for the current tenant. Requires `settings.write`. `tenantId` is set from JWT — not accepted from body.

**Request:** `{ "name": "Shift Supervisor" }`

### DELETE /api/v1/roles/:id

Soft-deletes a custom role. Returns `409` if any `User` currently holds this role. Returns `403` if the role is `isBuiltIn: true` — built-in roles cannot be deleted.

### GET /api/v1/roles/:id/permissions

Returns the full permission set for a role as a flat array.

**Response:**
```json
{
  "data": [
    { "module": "sales", "action": "read", "granted": true },
    { "module": "sales", "action": "write", "granted": true },
    { "module": "sales", "action": "refund", "granted": false }
  ]
}
```

### PUT /api/v1/roles/:id/permissions

Replaces the permission set for a custom role. Returns `403` if the role is `isBuiltIn: true` — built-in role permissions cannot be modified. Requires `settings.write`.

**Request:**
```json
{
  "permissions": [
    { "module": "sales", "action": "read", "granted": true },
    { "module": "sales", "action": "write", "granted": true }
  ]
}
```

### User Management

- `GET /api/v1/users` — paginated list; `?isActive=`; requires `settings.read`
- `POST /api/v1/users` — create/invite user; requires `settings.write`; `tenantId` from JWT
- `PATCH /api/v1/users/:id` — update user including role assignment; requires `settings.write`
- `DELETE /api/v1/users/:id` — soft-delete; requires `settings.delete`; cannot delete self

---

## 6.6 Core Business Entity Endpoints

All list endpoints support `?pageIndex=&pageSize=` pagination per 6.1. All write endpoints validate against the corresponding Zod schema (mirroring the frontend's `src/lib/validation/` schemas).

### Customers

- **GET /api/v1/customers** — `?isActive=`, `?search=` (matches name or email)
- **POST /api/v1/customers** — requires `customers.write`; email unique within tenant enforced by DB constraint
- **GET /api/v1/customers/:id** — returns customer detail plus paginated order history filtered by `customerId` FK (DEBT-004 resolution — not name-string matching)
- **PATCH /api/v1/customers/:id** — partial update; requires `customers.write`
- **DELETE /api/v1/customers/:id** — soft-delete; requires `customers.delete`

### Suppliers

Same shape as Customers. `GET /suppliers/:id` includes paginated PO history filtered by `supplierId` FK (replacing the `supplierName` string-match).

- **GET /api/v1/suppliers**, **POST**, **GET /:id**, **PATCH /:id**, **DELETE /:id**

### Products

`PATCH /products/:id` updates metadata only — `stock` is not writable here. Stock changes go through `POST /inventory/adjustments` (6.8) so every change is audited.

- **GET /api/v1/products** — `?category=`, `?lowStock=true` (stock ≤ reorderPoint), `?search=`
- **POST /api/v1/products** — requires `inventory.write`
- **GET /api/v1/products/:id**
- **PATCH /api/v1/products/:id** — metadata only; `inventory.write`
- **DELETE /api/v1/products/:id** — soft-delete; `inventory.delete`; returns `409` if product has OrderLine or POLine history (soft-delete only)

---

## 6.7 Sales / Orders Endpoints

### GET /api/v1/orders

Paginated order list. Supports filtering:
- `?status=Pending|Completed|Refunded`
- `?customerId=<uuid>`
- `?branchId=<uuid>` — enables the branch-level filtering that the frontend Reports module had to mark as blocked
- `?dateFrom=<ISO date>` and `?dateTo=<ISO date>`

Requires `sales.read`.

**Response rows carry `customerName` and `lineCount`** in addition to the `Order` columns:

```json
{
  "id": "uuid",
  "orderNumber": "#1042",
  "date": "2026-08-26T09:14:00.000Z",
  "customerId": "uuid-or-null",
  "customerName": "Ayesha Khan",
  "lineCount": 3,
  "status": "Completed",
  "taxRateBps": 1700,
  "subtotalCents": 450000,
  "taxAmountCents": 76500,
  "totalCents": 526500
}
```

**On `customerName` / `lineCount`:**

Both are additions beyond this section's original field list, and both exist to keep the sales history renderable in one request. Without `customerName` a list can only show a customer *id*, and the only way to name the buyer is a `GET /customers/:id` per row — an N+1 on the busiest read in the product. Without `lineCount` an item count requires loading every order's lines and discarding them.

They are joined, not stored: one join per page, no extra round trips.

`customerName` is deliberately **not** a snapshot, which puts it in opposition to `OrderLine.productNameSnapshot` (BR-10). The distinction is intentional and worth stating, because the two look like the same problem:

- A line's product name must never move. It is what the receipt said when it printed, and a repricing or rename must not rewrite history.
- An order's customer name should move. A renamed customer is the *same* customer, and a sales history that still shows a former name reads as a different person — which is worse than useless when the list is being used to find someone's orders.

`customerName` is `null` for a walk-in sale, exactly as `customerId` is. Both are returned rather than one being derived from the other, so a client never has to decide whether an absent name means "walk-in" or "not loaded".

`lineCount` counts **lines, not units** — `2` means two distinct products were sold, not two items.

### POST /api/v1/orders

Creates an order with line items. Requires `sales.write`.

**Server-computed fields:** `subtotalCents`, `taxAmountCents`, `totalCents` are computed by the server from the submitted lines and `taxRateBps` — the client never submits totals directly. If client-submitted totals are present in the body, they are silently ignored.

**Request:**
```json
{
  "customerId": "uuid-or-null",
  "branchId": "uuid",
  "paymentMethod": "Cash",
  "taxRateBps": 1700,
  "lines": [
    { "productId": "uuid", "quantity": 2 }
  ]
}
```

`unitPriceCents` is looked up from `Product.priceCents` at order creation time and stored as `OrderLine.unitPriceCents` (snapshot — not the current price at read time).

### GET /api/v1/orders/:id

Returns order detail with all lines. Requires `sales.read`.

### PATCH /api/v1/orders/:id/status

Transitions `Order.status` from `Pending` to `Completed`. Requires `sales.write`.

After `status = 'Completed'`, financial columns (`subtotalCents`, `taxAmountCents`, `totalCents`) are locked at the application layer — any attempt to modify them returns `409`. This enforces BR-03.

**Request:** `{ "status": "Completed" }`

### POST /api/v1/orders/:id/refund *(BR-03 reversal — requires `sales.refund`)*

Creates a `RefundTransaction` row and sets `Order.status = 'Refunded'` as a side effect. This is the only write path for a refund — `Order.status` is not a client-writable field.

Requires `sales.refund` permission — not `sales.write` or `sales.delete`. The permission distinction enforces BR-03 at the RBAC layer: refunding is a separate, auditable action, not a destructive edit.

**Request:**
```json
{ "amountCents": 150000, "reason": "Customer returned item" }
```

`amountCents` may be less than `Order.totalCents` (partial refund). Multiple refunds on the same order are permitted — each creates a new `RefundTransaction` row. `Order.status = 'Refunded'` means "at least one refund exists" — not necessarily fully refunded.

**Response:** `201 Created` — the created `RefundTransaction` object.

### No DELETE /api/v1/orders/:id

This endpoint does not exist. BR-03 (financial immutability) prohibits hard-deleting posted transactions. Any client that attempts `DELETE /orders/:id` receives `404` — the route is not registered, not a `403` that could be misread as "you don't have permission but the operation theoretically exists."

---

## 6.8 Inventory Endpoints

### POST /api/v1/inventory/adjustments

Creates a `StockAdjustment` record and updates `Product.stock` atomically in a single Prisma transaction. Requires `inventory.write`.

**Request:**
```json
{
  "productId": "uuid",
  "branchId": "uuid",
  "type": "REMOVE",
  "quantityDelta": 5,
  "reasonCode": "Damaged"
}
```

For `type: COUNT`, `quantityDelta` is the absolute new stock level (not a delta). The server computes the actual delta (`quantityDelta - currentStock`) before storing.

`newStockLevel` on the `StockAdjustment` row is set by the server, not trusted from the client.

**Response:** `201 Created` — the `StockAdjustment` object including `newStockLevel`.

### GET /api/v1/inventory/adjustments

Paginated audit log. Supports `?productId=`, `?branchId=`, `?type=`, `?dateFrom=`, `?dateTo=`. Requires `inventory.read`.

### GET /api/v1/inventory/alerts

Returns products where `stock = 0` (out of stock) or `stock > 0 AND stock <= reorderPoint` (low stock). Used by the Dashboard's Inventory Health widget. Requires `inventory.read`.

**Response:**
```json
{
  "outOfStock": [ { "id": "...", "name": "USB-C Cable", "stock": 0 } ],
  "lowStock": [ { "id": "...", "name": "Monitor Stand", "stock": 2, "reorderPoint": 5 } ]
}
```

---

## 6.9 Purchases Endpoints

### GET /api/v1/purchase-orders

Paginated. Supports `?status=`, `?supplierId=`, `?dateFrom=`, `?dateTo=`. Requires `purchases.read`.

### POST /api/v1/purchase-orders

Creates a PO with line items. Requires `purchases.write`. Server computes `subtotalCents` and `totalCents` from lines — not trusted from client. `unitCostCents` per line is accepted from the client (buyer-negotiated cost, independent of `Product.costCents`).

`supplierNameSnapshot` is set by the server at creation time by reading `Supplier.name` — not accepted from the client body.

### GET /api/v1/purchase-orders/:id

Returns PO detail with all lines and status transition history. Requires `purchases.read`.

### PATCH /api/v1/purchase-orders/:id/status *(DEBT-002 server-side enforcement)*

Transitions PO status. Requires `purchases.write`.

The server validates the requested `toStatus` against the `PO_TRANSITIONS` map for the current status:
```
Draft     → Sent, Cancelled
Sent      → Received, Cancelled
Received  → (terminal — no transitions allowed)
Cancelled → (terminal — no transitions allowed)
```

If the requested transition is not in the allowed set for the current status, the server returns `409 Conflict` with `code: "INVALID_STATUS_TRANSITION"`. This is the server-side enforcement of what the frontend's `PO_TRANSITIONS` constant provides as a UX affordance — they share the same rule, but the server enforces it regardless of what the client sends.

On a valid transition, a `POStatusTransition` row is inserted before `PurchaseOrder.status` is updated, atomically.

**Request:** `{ "toStatus": "Sent" }`

### GET /api/v1/purchase-orders/:id/transitions

Returns the full `POStatusTransition` history for a PO, ordered by `changedAt` ascending. Requires `purchases.read`.

### No DELETE or financial field PATCH

Same BR-03 reasoning as Orders. No `DELETE /purchase-orders/:id` endpoint exists. `subtotalCents` and `totalCents` are locked after creation — they are server-computed at creation time and not updatable.

---

## 6.10 Billing / Module Subscription Endpoints *(closes UC-04 mutation path)*

These endpoints are the write side of the enforcement that 6.2's middleware performs on read. `GET /billing/modules` lets a tenant admin see what's enabled; `PATCH /billing/modules` is how they change it.

All endpoints require `settings.write` unless noted.

### GET /api/v1/billing/modules

Returns all modules and their current subscription status for the current tenant. Readable with `settings.read`.

**Response:** `200 OK`
```json
{
  "data": [
    { "moduleKey": "sales", "enabled": true, "enabledAt": "2026-01-01T00:00:00Z" },
    { "moduleKey": "purchases", "enabled": true, "enabledAt": "2026-01-01T00:00:00Z" },
    { "moduleKey": "clinic", "enabled": false, "disabledAt": "2026-06-01T00:00:00Z" }
  ]
}
```

`enabled` is `true` if a `TenantModuleSubscription` row exists for this `(tenantId, moduleKey)` and `disabledAt IS NULL`.

### PATCH /api/v1/billing/modules *(UC-04 — enabled immediately, no redeployment)*

Enables or disables a module. Effect is immediate — the next request from any user in this tenant will see the updated state via the middleware's `TenantModuleSubscription` check.

**Request:**
```json
{
  "moduleKey": "clinic",
  "enabled": true,
  "effectiveDate": "2026-08-01"
}
```

`effectiveDate` is used to calculate proration per FR-BILL-02. The response includes the prorated charge for confirmation before the change is committed.

**Response:** `200 OK`
```json
{
  "moduleKey": "clinic",
  "enabled": true,
  "proratedChargeCents": 125000,
  "effectiveDate": "2026-08-01",
  "message": "Module will be enabled. A prorated charge of Rs 1,250.00 will be applied to your next invoice."
}
```

The proration amount is returned for display — the client must confirm (re-POST with `{ "confirmed": true }`) before the change is committed to `TenantModuleSubscription`. This prevents silent billing side effects from an enable/disable toggle.

### GET /api/v1/billing/subscription

Returns the current `TenantSubscription` with plan details. Readable with `settings.read`.

**Response:**
```json
{
  "plan": { "name": "Growth", "priceMonthly": 1299900 },
  "status": "Active",
  "currentPeriodStart": "2026-08-01T00:00:00Z",
  "currentPeriodEnd": "2026-08-31T23:59:59Z"
}
```

### GET /api/v1/plans

Returns available plans with included modules. Public within the authenticated tenant context — no special permission required beyond `settings.read`.

**Response:**
```json
{
  "data": [
    {
      "id": "...",
      "name": "Starter",
      "priceMonthly": 499900,
      "modules": ["dashboard", "inventory", "sales", "customers"]
    },
    {
      "id": "...",
      "name": "Growth",
      "priceMonthly": 1299900,
      "modules": ["dashboard", "inventory", "sales", "customers", "purchases", "reports"]
    }
  ]
}
```

`modules` here is informational — it describes what a plan includes at onboarding for convenience. It is not the live access-control list. `GET /billing/modules` is the authoritative source for what is currently enabled.

---

## 6.11 Reports Endpoints

All require `reports.read`. All return paginated or aggregated data derived from the live database — not from frontend contexts.

All list-type report endpoints support `?format=csv` to return a CSV file instead of JSON. The `Content-Type` header changes to `text/csv` and the response body is a CSV stream. This partially resolves DEBT-009 — CSV export is in scope; PDF requires a server-side rendering library decision and is deferred.

### GET /api/v1/reports/sales-summary

Aggregated sales data. Supports `?dateFrom=`, `?dateTo=`, `?branchId=`.

Returns revenue totals, order counts by status, and payment method breakdown. This is the server-side version of what the frontend's `SalesSummaryTab` computed from the mock array.

### GET /api/v1/reports/sales-summary/orders

Paginated list of orders matching the filter. Same query parameters as above. Used to populate the filtered order table in the frontend Reports tab.

### GET /api/v1/reports/inventory-valuation

Per-product valuation. Server computes `priceCents * stock` and `costCents * stock`. Supports `?category=`.

### GET /api/v1/reports/customer-activity

Per-customer order count and total spend, filtered by `customerId` FK. Sorted by `totalSpend` descending by default.

### GET /api/v1/reports/supplier-spend

Per-supplier PO value and count, filtered by `supplierId` FK. Replaces the `supplierName` string-match used in the frontend.

---

## 6.12 Cross-References to Documentation Debt

Items whose **resolution path is fully specified** by Section 6 (endpoint contracts exist; resolution requires backend to be built):

| Item | Resolution path |
|---|---|
| DEBT-004 — Customer FK in Orders | `POST /orders` accepts `customerId`; `GET /customers/:id` returns order history by FK |
| DEBT-006 — RoleProvider client-only | `GET /auth/me` returns `roleName` → `RoleProvider.initialRole`; role-switcher dropdown removed |
| DEBT-007 — Custom roles type system | `POST /roles`, `PUT /roles/:id/permissions` endpoints specified; frontend `Role` widens to `string` |
| DEBT-008 — Company profile tax rate | `GET /settings` returns `defaultTaxRateBps`; `NewOrderForm` pre-fills from this |
| DEBT-009 — Reports export | `?format=csv` on report endpoints; PDF deferred |
| DEBT-011 — MOCK_ORDERS static *(resolved in code; API replaces context)* | `GET /orders` replaces `OrdersContext`; all consumers require no shape changes |
| DEBT-012 — Float monetary values | All API bodies use `*Cents` integers holding minor units; frontend formats via `src/lib/format/currency.ts` |

Items not addressed here (genuinely deferred to other sections):

| Item | Target section |
|---|---|
| DEBT-001 — Password complexity rules | Section 3 (SRS update) |
| DEBT-002 — PO state machine server-enforced | Specified in 6.9; schema already in Section 5 |
| DEBT-003 — Supplier name snapshot on POs | Section 9 (Purchases spec) |
| DEBT-005 — Supplier category taxonomy | Section 9 |
| DEBT-010 — Customer/Supplier ledger | Sections 8/9 |
| DEBT-013 — Rate limit thresholds | Numeric values TBD — product decision required |

---

## 6.13 Out of Scope

- **AI endpoints** → Section 7 (AIProviderInterface implementation)
- **Financial ledger** (Invoice, Payment, CreditNote) → Sections 8/9 (DEBT-010)
- **Webhook / event delivery** — deferred
- **Super-tenant / admin endpoints** (global tenant provisioning, plan CRUD) → Section 10
- **Implementation code** (NestJS decorators, Prisma syntax) — build task, not design doc
- **PDF export** — library decision deferred; CSV is in scope via `?format=csv`
