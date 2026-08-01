"use client"

// ---------------------------------------------------------------------------
// src/components/settings/PermissionMatrixTable.tsx
//
// Read-only visualisation of DEFAULT_ROLE_PERMISSIONS.
// Reads directly from the permissions config — no props, no state.
//
// This table is uniformly read-only regardless of the viewing role.
// No hover states, no cursor-pointer, no interactive elements in cells.
// Editability requires FR-SET-02 (custom roles) + a runtime permission
// store — both are out of scope for this pass. See DEBT-007.
// ---------------------------------------------------------------------------

import {
  DEFAULT_ROLE_PERMISSIONS,
  Modules,
  Actions,
  Role,
} from "@/config/permissions"

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

// Human-readable module labels
const MODULE_LABELS: Record<Modules, string> = {
  [Modules.DASHBOARD]:  "Dashboard",
  [Modules.INVENTORY]:  "Inventory",
  [Modules.SALES]:      "Sales / POS",
  [Modules.CUSTOMERS]:  "Customers",
  [Modules.PURCHASES]:  "Purchases",
  [Modules.REPORTS]:    "Reports",
  [Modules.SETTINGS]:   "Settings",
  [Modules.CLINIC]:     "Clinic",
  [Modules.PHARMACY]:   "Pharmacy",
  [Modules.RESTAURANT]: "Restaurant",
}

// Short badge labels for each action
const ACTION_LABELS: Record<Actions, string> = {
  [Actions.READ]:   "R",
  [Actions.WRITE]:  "W",
  [Actions.DELETE]: "D",
  [Actions.REFUND]: "Rf",
}

// Display order for actions within a cell (consistent left-to-right)
const ACTION_ORDER: Actions[] = [
  Actions.READ,
  Actions.WRITE,
  Actions.DELETE,
  Actions.REFUND,
]

const ROLES: Role[] = ["Owner", "Manager", "Cashier"]

// Modules shown in the table, in display order
const MODULE_ORDER: Modules[] = [
  Modules.DASHBOARD,
  Modules.INVENTORY,
  Modules.SALES,
  Modules.CUSTOMERS,
  Modules.PURCHASES,
  Modules.REPORTS,
  Modules.SETTINGS,
  Modules.CLINIC,
  Modules.PHARMACY,
  Modules.RESTAURANT,
]

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PermissionMatrixTable() {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        This table shows the default permission set for the three built-in roles.
        Custom role management (FR-SET-02) is not yet available — the matrix is
        read-only. See{" "}
        <span className="font-mono text-xs">DOCUMENTATION_DEBT.md</span>{" "}
        DEBT-007 for the planned custom-roles implementation.
      </p>

      <div className="rounded-md border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground w-40">
                Module
              </th>
              {ROLES.map((role) => (
                <th
                  key={role}
                  className="px-4 py-2.5 text-left font-medium text-muted-foreground"
                >
                  {role}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MODULE_ORDER.map((module, idx) => (
              <tr
                key={module}
                className={idx % 2 === 0 ? "bg-background" : "bg-muted/20"}
              >
                <td className="px-4 py-2.5 font-medium">
                  {MODULE_LABELS[module]}
                </td>
                {ROLES.map((role) => {
                  const perms = DEFAULT_ROLE_PERMISSIONS[role]?.[module]
                  const granted = ACTION_ORDER.filter((a) => perms?.has(a))

                  return (
                    <td
                      key={role}
                      className="px-4 py-2.5"
                      // Explicit cursor-default — this table is read-only for
                      // all roles, including Owner. No interactive intent here.
                      style={{ cursor: "default" }}
                    >
                      {granted.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="flex gap-1 flex-wrap">
                          {granted.map((action) => (
                            <span
                              key={action}
                              className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-primary/10 text-primary"
                            >
                              {ACTION_LABELS[action]}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground pt-1">
        <span className="font-medium">Legend:</span>
        {ACTION_ORDER.map((a) => (
          <span key={a}>
            <span className="inline-flex items-center rounded px-1.5 py-0.5 font-medium bg-primary/10 text-primary mr-1">
              {ACTION_LABELS[a]}
            </span>
            {a === Actions.READ   && "Read"}
            {a === Actions.WRITE  && "Write"}
            {a === Actions.DELETE && "Delete"}
            {a === Actions.REFUND && "Refund (Sales only)"}
          </span>
        ))}
        <span><span className="text-muted-foreground mr-1">—</span>No access</span>
      </div>
    </div>
  )
}
