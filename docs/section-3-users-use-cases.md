# Section 3: Users and Use Cases

> **Document status:** **Reconstructed.** See the preamble to Section 1 for the provenance markers — **[pinned]**, **[reconstructed]**, **[open]**.
>
> This section is cited by `src/config/permissions.ts` ("Three fixed roles per Section 3 personas") and is the designated home of the password policy that `DOCUMENTATION_DEBT.md` DEBT-001 requires. Identifiers defined here: `UC-01`–`UC-09`.

---

## 3.1 User Classes and Personas

Three built-in roles exist, and they are global rather than per-tenant (D-02). The personas below are **[pinned]** — they are named in `src/config/permissions.ts`, and the role names are the literal values stored in the `Role` table.

### Ayesha — Owner

Owns the business and carries the financial risk. Checks yesterday's numbers before opening, approves supplier payments, and is the only person who should see or change what the business is paying for. Not a daily operator of the POS; her time in the system is short and decision-oriented. **Needs:** trustworthy totals, no surprises, and the ability to delegate without handing over billing.

### Sana — Manager

Runs the shop floor day to day. Receives stock, raises purchase orders, fixes the mistakes cashiers make, and reads reports to plan reordering. **Deliberately excluded from billing and tenant administration** — she runs operations but does not decide what the business pays for. Can read Settings to see how the system is configured but cannot change it. **Needs:** speed, and enough authority to correct errors without escalating.

### Bilal — Cashier

Front desk. Rings up sales, looks up a price or a customer, and answers "do we have this in stock". Has no view of margin, purchasing, or reporting. **Cannot refund** — a refund is a financial reversal and is escalated to Sana or Ayesha. **Needs:** a fast, forgiving sale screen and no capacity to do damage.

**Not a role:** the platform operator who provisions tenants and maintains the plan catalogue. That actor is served by the super-tenant admin API and belongs to Section 10, not to any tenant's role set. *[pinned]*

## 3.2 Role → Permission Matrix

The authoritative matrix, transcribed from `DEFAULT_ROLE_PERMISSIONS`. **R** = read, **W** = write, **D** = delete, **Rf** = refund, **—** = no access at all (the module is absent from the role, so every action is denied).

| Module | Owner | Manager | Cashier |
|---|---|---|---|
| `dashboard` | R | R | R |
| `inventory` | R W D | R W | R |
| `sales` | R W D **Rf** | R W **Rf** | R W |
| `customers` | R W D | R W | R |
| `purchases` | R W D | R W | — |
| `reports` | R W D | R | — |
| `settings` | R W D | R | — |
| `clinic` · `pharmacy` · `restaurant` | R W D | R W | R |
| `billing` | R W D | — | — |

Three properties of this matrix are load-bearing:

1. **`refund` is its own action, not implied by `write` or `delete`.** Cashier has `sales.write` but not `sales.refund`. This is BR-03 expressed in the permission model: a refund is a reversing transaction, so it is grantable and revocable independently of both order creation and record deletion. *[pinned]*
2. **The matrix is not a superset.** An earlier database seed granted Manager `settings.write`, Manager `delete` on three modules, Cashier `customers.write`, and Cashier `reports.read`. None of those are in the canonical matrix. They were inert while nothing read the table, but the permission guard makes the table live authorization, so the seed now **prunes** them. *[pinned]*
3. **`billing` is backend-only, and its row is an inference.** There is no `BILLING` member in the frontend `Modules` enum, because no billing UI exists yet. Owner-only follows the stated intent that "Manager runs operations but cannot touch billing", but Section 6.10 never specified a required permission — so this row is a reasoned default awaiting confirmation, not a transcription. *[pinned as an open point — DEBT-016]*

**Permission checks are always by capability, never by role name.** Consumers call `canPerform(module, action)`; no component branches on `role === "Manager"`. This is the precondition for custom roles (FR-SET-02) working without touching call sites. *[pinned]*

### Access gating is two independent layers

A request is allowed only if **both** pass, and they are not interchangeable:

| Layer | Question | Applies to |
|---|---|---|
| **Module availability** | Is this module switched on for this tenant? | Industry modules only — core modules always pass *(FR-BILL-03, DEBT-016)* |
| **Role permission** | Does this user's role grant this action on this module? | Every module, including core |

So a tenant without the `pharmacy` subscription is refused regardless of role, and a Cashier is refused `purchases` regardless of subscription. Core modules are gated by the role layer alone. *[pinned]*

## 3.3 Authentication and Security

### 3.3.1 Password Policy — *closes DEBT-001*

The policy below is the exact set of constraints enforced by `passwordSchema` in `src/lib/validation/auth.ts`, transcribed rather than described. It applies at **registration** and at **password reset**. *[pinned]*

A password must:

| # | Rule |
|---|---|
| 1 | Be at least **8 characters** long |
| 2 | Contain at least one **lowercase** letter (`a–z`) |
| 3 | Contain at least one **uppercase** letter (`A–Z`) |
| 4 | Contain at least one **digit** (`0–9`) |
| 5 | Contain at least one **non-alphanumeric** character (anything outside `A–Za–z0–9`) |

There is **no** maximum length, no character-class denylist, no dictionary or breach check, and no enforced rotation or history. *[pinned — by absence from the schema]*

**A deliberate asymmetry: the login form does not apply this policy.** At login, the password field requires only that it be non-empty. Validating complexity at login would lock out any user whose password predates a policy change, and would leak the policy to an attacker probing the form. Any API-side auth implementation must preserve this asymmetry — **enforce the policy on set, never on verify.** *[pinned — `loginSchema` uses `min(1)`]*

Confirmation fields at registration and reset must equal the password field; the mismatch error is attached to the confirmation field, not the password field. *[pinned]*

### 3.3.2 Second Factor

A one-time code is exactly **6 characters, digits only** — no letters, no separators, no variable length. *[pinned — `mfaChallengeSchema`]* It is time-based (TOTP). *[pinned — `totp.service.ts`]*

### 3.3.3 Sessions and Tokens

A short-lived access token carries identity, tenant, and role; a refresh token is delivered as an **httpOnly cookie** so client JavaScript cannot read it. Because the refresh cookie must survive a cross-origin request from the frontend, the API's CORS configuration allows credentials against an explicit origin allow-list — never a reflection of the request's `Origin`, which with credentials enabled would let any site drive the API using a user's cookie. *[pinned — Section 6.3, `main.ts`]*

Module access is re-checked on every request rather than baked into the token (FR-BILL-03), which is what allows UC-04 to take effect without re-issuing a token.

### 3.3.4 Password Reset

*[pinned — DEBT-015]*

1. A user submits an email address. **The response is identical whether or not that address is registered** — no enumeration.
2. A reset token is generated and delivered by email. Only a **hash** of the token is stored, under a unique constraint; the plaintext token exists only in the message.
3. The stored record carries an **expiry** and a **used-at** marker, so a token is single-use and time-bounded.
4. Completing the reset requires the policy in 3.3.1.
5. Deleting a user cascades to their outstanding reset tokens.

Two implementation obligations follow, and both are already honoured by the no-op provider: an implementation must **never log the token**, and must **never throw for an unknown address** (throwing is itself an enumeration oracle). **[open]** — no real mail transport is selected yet; delivery is a no-op until one is chosen (NFR-12).

## 3.4 Use Cases

### UC-01 — Register a new tenant *[reconstructed]*

**Actor:** prospective Owner. **Precondition:** none.
Supplies business name, full name, email, password (3.3.1), and accepts terms → tenant created, registering user becomes Owner, built-in roles available, all core modules active, **no** industry modules active.
**Exercises:** FR-AUTH-01, D-01, D-02, §1.5.2.

### UC-02 — Log in *[pinned — DEBT-014]*

**Actor:** any user. **Precondition:** an active, non-deleted user exists.
Submits email + password, with no tenant identifier. The system resolves the user by email alone; under D-01 that yields at most one account. On a second factor being configured, a 6-digit challenge follows (3.3.2). Success issues an access token and a refresh cookie.
**Notes:** the "exactly one candidate" condition is enforced fail-closed, and a decoy password verification runs when no candidate matches, so response timing does not disclose whether an email is registered.
**Exercises:** FR-AUTH-02, FR-AUTH-04, FR-AUTH-06, D-01.

### UC-03 — Ring up a sale *[reconstructed]*

**Actor:** Bilal (Cashier). **Precondition:** holds `sales.write`; products in stock.
Selects products, optionally links a customer, completes the order. The server computes subtotal, tax, and total (BR-05); stock decrements in the same transaction (BR-02); financial columns lock on completion (BR-03); product names are snapshotted onto the lines (BR-10).
**Refused when:** a line would take stock below zero (BR-04).
**Exercises:** FR-SALE-01 → 04, FR-CUST-02.

### UC-04 — Enable or disable an industry module *[pinned]*

**Actor:** Ayesha (Owner), holding `billing.write`. **Precondition:** tenant active.
Views current module subscriptions, toggles an industry module, confirms.

**The defining guarantee:** the change takes effect **on the very next request** — no redeployment, no cache invalidation, no re-issued token, no logout. Enabling makes the module reachable immediately; disabling makes it refused immediately.

**Scope limit:** only `clinic`, `pharmacy`, and `restaurant` can be toggled. Core modules are not subscription-gated and cannot be disabled by this or any other path (§1.5.1, DEBT-016/018).
**[open]:** the proration figure shown at confirmation is `null`, because FR-BILL-02 does not exist and no per-module price exists. The confirmation step is retained regardless.
**Exercises:** FR-BILL-01, FR-BILL-03, D-03. *(Verified end to end by `billing.controller.spec.ts`.)*

### UC-05 — Refund a completed order *[pinned — BR-03]*

**Actor:** Sana (Manager) or Ayesha (Owner) — **not** Bilal. **Precondition:** holds `sales.refund` specifically; order is `Completed`.
Selects the order, enters a refund amount (full or partial), confirms. A reversing refund record is created. **The order is never modified**, and no endpoint exists to delete it — the route is absent entirely rather than returning 403, so it cannot be misread as "permitted in principle".
**Refused when:** cumulative refunds would exceed the order total (BR-09).
**Not supported in v1:** attributing a refund to specific lines (FR-SALE-05, deferred).
**Exercises:** FR-SALE-05, BR-03, BR-09.

### UC-06 — Receive stock against a purchase order *[reconstructed]*

**Actor:** Sana (Manager). **Precondition:** holds `purchases.write`; a PO exists in a receivable state.
Raises a PO against a supplier (name snapshotted — BR-10), advances it through the state machine with every transition re-validated server-side (BR-08), and receives stock, which increments the receiving branch's on-hand atomically (BR-02, FR-TEN-03).
**Exercises:** FR-PUR-01 → 06.

### UC-07 — Review performance *[reconstructed]*

**Actor:** Ayesha (Owner) or Sana (Manager, read-only).
Selects a date range and optionally a branch (FR-REP-02), reads sales/inventory/purchasing reports. Export is **[open]** (FR-REP-03, DEBT-009). AI-generated insight is a deferred stub (FR-AI-03).
**Exercises:** FR-REP-01, FR-REP-02.

### UC-08 — Manage users and roles *[reconstructed]*

**Actor:** Ayesha (Owner). **Precondition:** holds `settings.write`.
Invites a user, assigns a built-in role, deactivates a leaver. Creating **custom** roles is FR-SET-02 and not yet built (DEBT-007). The built-in roles cannot be edited or deleted (D-02). An invited user belongs to this tenant and no other (D-01).
**Exercises:** FR-SET-02, FR-SET-03, D-01, D-02.

### UC-09 — Recover a forgotten password *[pinned]*

**Actor:** any user, unauthenticated.
Requests a reset by email → receives an identical response regardless of whether the address is registered (3.3.4) → follows a single-use, expiring token → sets a password meeting 3.3.1 → outstanding tokens for that user are spent.
**[open]:** delivery is a no-op until a mail transport is selected (NFR-12).
**Exercises:** FR-AUTH-05, FR-AUTH-03.

## 3.5 Use Case → Actor Coverage

| Use case | Owner | Manager | Cashier | Unauthenticated |
|---|---|---|---|---|
| UC-01 Register tenant | — | — | — | ✓ |
| UC-02 Log in | ✓ | ✓ | ✓ | ✓ |
| UC-03 Ring up a sale | ✓ | ✓ | ✓ | — |
| UC-04 Toggle industry module | ✓ | — | — | — |
| UC-05 Refund | ✓ | ✓ | — | — |
| UC-06 Receive stock | ✓ | ✓ | — | — |
| UC-07 Review performance | ✓ | read-only | — | — |
| UC-08 Manage users/roles | ✓ | — | — | — |
| UC-09 Password reset | ✓ | ✓ | ✓ | ✓ |

The table is a direct consequence of 3.2 and contains no independent authority — where the two disagree, the matrix in 3.2 wins.

## 3.6 Documentation Debt

Addressed by this section:

| Item | Status in this section |
|---|---|
| **DEBT-001 — Password complexity rules not in SRS** | **Resolved.** §3.3.1 enumerates the five constraints exactly as `passwordSchema` enforces them, records what is deliberately *absent* (no max length, no breach check, no rotation), and states the enforce-on-set/never-on-verify asymmetry that the login schema implies. |
| DEBT-015 — Password reset flow | **Addressed** for the behavioural half: §3.3.4 specifies non-enumeration, hashed-at-rest single-use expiring tokens, and the no-log obligation. Transport remains open. |

Noted but not closed here:

| Item | Why |
|---|---|
| DEBT-016 — `billing` permission row | §3.2 records Owner-only as a reasoned inference; Section 6.10 still specifies no required permission, so confirmation is product's. |
| DEBT-007 — Custom roles | UC-08 covers built-in role assignment only; custom roles need the type-system work in Section 6/9. |
