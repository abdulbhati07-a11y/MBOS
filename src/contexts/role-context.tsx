"use client"

// ---------------------------------------------------------------------------
// src/contexts/role-context.tsx
//
// RoleProvider — holds the current user role in context.
// useRole()       — read the current role.
// useCanPerform() — the single permission check hook used by all components.
// useSetRole()    — write the current role (used by the AppShell toggle only).
//
// DEBT-006 (resolved for built-in roles): the role is no longer invented here.
// AppShell seeds `initialRole` from `GET /auth/me` via SessionProvider, so this
// provider now holds a real, server-issued role. The context shape did not have
// to change — which was the point of designing it this way.
//
// What remains: the *permission matrix* is still a frontend copy
// (DEFAULT_ROLE_PERMISSIONS) hand-mirrored by the backend's ROLE_MATRIX, rather
// than the RolePermission rows the API actually enforces. That holds for the
// three built-in roles and fails closed for anything else — a role name with no
// matrix entry makes canPerform return false for every module. Custom roles
// (FR-SET-02) therefore render a dead UI until /auth/me returns the role's
// permission set instead of just its name.
// ---------------------------------------------------------------------------

import * as React from "react"
import {
  Role,
  Modules,
  Actions,
  DEFAULT_ROLE_PERMISSIONS,
} from "@/config/permissions"

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------
type RoleContextValue = {
  role: Role
  setRole: (role: Role) => void
  canPerform: (module: Modules, action: Actions) => boolean
}

const RoleContext = React.createContext<RoleContextValue | null>(null)

// ---------------------------------------------------------------------------
// Provider
//
// `initialRole` is normally supplied by AppShell from the session. The "Manager"
// default is only a fallback for a provider mounted outside a session — tests,
// Storybook-style harnesses, the /dev routes — and is never what a real user
// gets. A one-shot initial value is enough because SessionGate guarantees the
// session has resolved before AppShell (and therefore this provider) mounts.
//
// `useSetRole` exists for the dev-only "view as role" override in the header. It
// changes what the UI offers, not what the API allows.
// ---------------------------------------------------------------------------
export function RoleProvider({
  children,
  initialRole = "Manager",
}: {
  children: React.ReactNode
  initialRole?: Role
}) {
  const [role, setRole] = React.useState<Role>(initialRole)

  const canPerform = React.useCallback(
    (module: Modules, action: Actions): boolean => {
      const modulePerms = DEFAULT_ROLE_PERMISSIONS[role]?.[module]
      if (!modulePerms) return false
      return modulePerms.has(action)
    },
    [role]
  )

  const value = React.useMemo(
    () => ({ role, setRole, canPerform }),
    [role, canPerform]
  )

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

function useRoleContext(): RoleContextValue {
  const ctx = React.useContext(RoleContext)
  if (!ctx) {
    throw new Error("useRoleContext must be used within a RoleProvider")
  }
  return ctx
}

/** Read the current role. */
export function useRole(): Role {
  return useRoleContext().role
}

/** Write the current role. Used only by the AppShell header toggle. */
export function useSetRole(): (role: Role) => void {
  return useRoleContext().setRole
}

/**
 * The single permission check hook.
 * Returns true if the current role has the given action on the given module.
 * Use this everywhere — never compare role strings directly in components.
 */
export function useCanPerform(module: Modules, action: Actions): boolean {
  return useRoleContext().canPerform(module, action)
}

/**
 * Returns the raw canPerform function for the current role.
 * Used by use-permissions.ts to build the legacy usePermissions() interface
 * without violating rules-of-hooks.
 */
export function useCanPerformFn(): (module: Modules, action: Actions) => boolean {
  return useRoleContext().canPerform
}
