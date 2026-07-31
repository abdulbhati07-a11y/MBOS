// ---------------------------------------------------------------------------
// src/hooks/use-permissions.ts
//
// Re-exports useModuleAccess and usePermissions backed by the real RoleContext.
// Hook names are preserved for backward compatibility — Sidebar and other
// existing consumers import from this file and require no changes.
// ---------------------------------------------------------------------------

import { Modules, Actions } from "@/config/permissions"
import { useCanPerform, useCanPerformFn } from "@/contexts/role-context"

/**
 * Returns true if the current role can READ the given module.
 * Used by Sidebar to determine nav item visibility.
 * moduleKey is a string (from navConfig) — cast to Modules enum value.
 * Unknown module keys not present in the enum return false (safe default).
 */
export function useModuleAccess(moduleKey: string): boolean {
  return useCanPerform(moduleKey as Modules, Actions.READ)
}

/**
 * Returns per-action permission checkers bound to the current role.
 * Returns functions that accept a module string, matching the prior stub API
 * so existing call sites require no changes.
 *
 * useCanPerformFn() is called once at hook level (rules-of-hooks compliant),
 * then the returned function is closed over in each checker.
 */
export function usePermissions() {
  const canPerform = useCanPerformFn()
  return {
    canRead:   (module: string) => canPerform(module as Modules, Actions.READ),
    canWrite:  (module: string) => canPerform(module as Modules, Actions.WRITE),
    canDelete: (module: string) => canPerform(module as Modules, Actions.DELETE),
  }
}
