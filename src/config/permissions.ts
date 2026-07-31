// ---------------------------------------------------------------------------
// src/config/permissions.ts
//
// Role definitions, Actions enum, and the DEFAULT_ROLE_PERMISSIONS matrix.
// This is the single source of truth for what each role can do.
//
// Three fixed roles per Section 3 personas:
//   Owner   — Ayesha (full access)
//   Manager — Sana   (operational access, no billing/tenant admin)
//   Cashier — Bilal  (front-desk only)
//
// These are data instances of a generic role→permission model.
// Permission checks in components always use canPerform(module, action),
// never role === "Manager" or similar string comparisons.
//
// Forward-looking note: Reports and Settings have write/delete provisioned
// in the matrix for future granularity. No current UI control exercises
// those entries — they are scaffolding, not active gates.
//
// FR-SET-02 (custom roles): The shape of this matrix is designed to be
// data-driven. When custom roles are built, new Role values can be added
// with their own PermissionSet without changing how consumers call canPerform.
// ---------------------------------------------------------------------------

export enum Modules {
  DASHBOARD  = "dashboard",
  INVENTORY  = "inventory",
  SALES      = "sales",
  CUSTOMERS  = "customers",
  PURCHASES  = "purchases",
  REPORTS    = "reports",
  SETTINGS   = "settings",
  CLINIC     = "clinic",
  PHARMACY   = "pharmacy",
  RESTAURANT = "restaurant",
}

export enum Actions {
  READ   = "read",
  WRITE  = "write",
  DELETE = "delete",
  // REFUND is Sales-scoped. Per BR-03, a refund is a reversing transaction,
  // not a destructive delete. It is modelled as its own action so it can be
  // granted/revoked independently without conflating it with record deletion.
  REFUND = "refund",
}

export type Role = "Owner" | "Manager" | "Cashier"

// Set of actions granted for a single module
export type PermissionSet = Set<Actions>

// Full permission matrix: role → module → granted actions
export type PermissionMatrix = Record<Role, Partial<Record<Modules, PermissionSet>>>

// ---------------------------------------------------------------------------
// DEFAULT_ROLE_PERMISSIONS
//
// Matrix legend:
//   R  = READ    W  = WRITE   D  = DELETE   Rf = REFUND
//
// Module        Owner    Manager   Cashier
// dashboard     R        R         R
// inventory     RWD      RW        R
// sales         RWDRf    RWRf      RW         (Cashier: create orders, no refund)
// customers     RWD      RW        R
// purchases     RWD      RW        —          (Cashier: no access)
// reports       RWD      R         —
// settings      RWD      R         —
// industry*     RWD      RW        R          (clinic/pharmacy/restaurant)
// ---------------------------------------------------------------------------
const r   = new Set([Actions.READ])
const rw  = new Set([Actions.READ, Actions.WRITE])
const rwd = new Set([Actions.READ, Actions.WRITE, Actions.DELETE])
const rwrf  = new Set([Actions.READ, Actions.WRITE, Actions.REFUND])
const rwdrf = new Set([Actions.READ, Actions.WRITE, Actions.DELETE, Actions.REFUND])

export const DEFAULT_ROLE_PERMISSIONS: PermissionMatrix = {
  Owner: {
    [Modules.DASHBOARD]:  r,
    [Modules.INVENTORY]:  rwd,
    [Modules.SALES]:      rwdrf,
    [Modules.CUSTOMERS]:  rwd,
    [Modules.PURCHASES]:  rwd,
    [Modules.REPORTS]:    rwd,
    [Modules.SETTINGS]:   rwd,
    [Modules.CLINIC]:     rwd,
    [Modules.PHARMACY]:   rwd,
    [Modules.RESTAURANT]: rwd,
  },
  Manager: {
    [Modules.DASHBOARD]:  r,
    [Modules.INVENTORY]:  rw,
    [Modules.SALES]:      rwrf,
    [Modules.CUSTOMERS]:  rw,
    [Modules.PURCHASES]:  rw,
    [Modules.REPORTS]:    r,
    [Modules.SETTINGS]:   r,
    [Modules.CLINIC]:     rw,
    [Modules.PHARMACY]:   rw,
    [Modules.RESTAURANT]: rw,
  },
  Cashier: {
    [Modules.DASHBOARD]:  r,
    [Modules.INVENTORY]:  r,
    [Modules.SALES]:      rw,
    [Modules.CUSTOMERS]:  r,
    // purchases: omitted — no access at all (canPerform returns false)
    [Modules.CLINIC]:     r,
    [Modules.PHARMACY]:   r,
    [Modules.RESTAURANT]: r,
  },
}
