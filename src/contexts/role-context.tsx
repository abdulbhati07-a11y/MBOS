"use client"

// ---------------------------------------------------------------------------
// src/contexts/role-context.tsx
//
// RoleProvider — holds the current user role in context.
// useRole()       — read the current role.
// useCanPerform() — the single permission check hook used by all components.
// useSetRole()    — write the current role (used by the AppShell toggle only).
//
// DEBT-006: RoleProvider is backed by React state, not a real auth/session.
// The context shape (Role, canPerform(module, action)) is designed to accept
// a real role derived from a JWT/session token without any API changes to
// consumers. Swapping the state source is a Section 6/7 dependency.
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
// Default role is "Manager" — matches the prior per-page toggle default,
// so existing behaviour is unchanged on first render.
// TODO: replace default with role derived from auth session (Section 6/7).
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
