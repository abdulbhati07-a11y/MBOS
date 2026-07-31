/**
 * TODO: Wire these hooks to real tenant subscription and RBAC data
 * once the API layer (Section 6) exists.
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function useModuleAccess(_moduleKey: string): boolean {
  // Stub: return true to allow access to all modules for now
  return true
}

export function usePermissions() {
  // Stub: return an object that allows everything for now
  return {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    canRead: (_module: string) => true,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    canWrite: (_module: string) => true,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    canDelete: (_module: string) => true,
  }
}
