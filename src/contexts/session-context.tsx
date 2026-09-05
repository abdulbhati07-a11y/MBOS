"use client"

// ---------------------------------------------------------------------------
// src/contexts/session-context.tsx
//
// The real auth session. This is what closes DEBT-006: until now RoleProvider
// defaulted to a hardcoded `initialRole = "Manager"` and the header carried a
// demo role switcher, because there was nothing to derive a role from.
//
// Boot sequence, in order:
//
//   1. POST /auth/refresh  — the access token lives in memory only, so a page
//      reload always starts with none. The refresh token is an httpOnly cookie
//      the browser still holds, so this mints a fresh access token without the
//      user re-authenticating. A 401 here simply means "not logged in".
//   2. GET /auth/me        — identity, tenant and role name for the new token.
//
// Until step 2 resolves, status is "loading". Consumers must not render a
// permission-gated UI in that window: `canPerform` would be answering from a
// guessed role. `SessionGate` below exists so pages do not each re-implement
// that wait.
// ---------------------------------------------------------------------------

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  refreshAccessToken,
  setAuthFailureHandler,
  isApiError,
} from "@/lib/api/client"
import { fetchCurrentUser } from "@/lib/api/auth/queries"
import { logout as logoutRequest } from "@/lib/api/auth/mutations"
import type { CurrentUserResponse } from "@/lib/api/types"
import { DEFAULT_ROLE_PERMISSIONS, type Role } from "@/config/permissions"

export type SessionStatus = "loading" | "authenticated" | "unauthenticated"

interface SessionContextValue {
  status: SessionStatus
  user: CurrentUserResponse | null
  /**
   * The user's role, narrowed to the three the permission matrix knows.
   * Null while loading, or when the backend reports a role this build has no
   * matrix entry for — see `resolveRole`.
   */
  role: Role | null
  /** Re-reads `GET /auth/me`. Call after anything that can change the role. */
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

const SessionContext = React.createContext<SessionContextValue | null>(null)

/**
 * Narrows the backend's free-form `roleName` to a `Role` the permission matrix
 * can answer for.
 *
 * The three built-in roles are safe: `backend/src/access-control/
 * access-control.constants.ts` transcribes ROLE_MATRIX cell-for-cell from
 * `DEFAULT_ROLE_PERMISSIONS`, and the seed creates exactly those names.
 *
 * Custom roles (FR-SET-02) are not safe, and this returns null for them rather
 * than guessing. The consequence is a fail-closed UI — `canPerform` denies
 * everything, so the user sees a dashboard with no actions — which is wrong but
 * not unsafe. The real fix is for `GET /auth/me` to return the role's permission
 * set instead of its name, so the frontend stops keeping a second copy of the
 * matrix at all. Recorded as debt rather than papered over here.
 */
function resolveRole(roleName: string): Role | null {
  return roleName in DEFAULT_ROLE_PERMISSIONS ? (roleName as Role) : null
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [status, setStatus] = React.useState<SessionStatus>("loading")
  const [user, setUser] = React.useState<CurrentUserResponse | null>(null)

  // Loads the current user against whatever access token is in hand. Separated
  // from boot so `refresh()` can reuse it without re-running the refresh call.
  const loadUser = React.useCallback(async (signal?: AbortSignal) => {
    const current = await fetchCurrentUser(signal)
    setUser(current)
    setStatus("authenticated")
  }, [])

  React.useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    async function boot() {
      // Single-flight inside the client, so React's dev-mode double effect
      // invocation coalesces onto one request rather than racing two rotations
      // of a single-use refresh token.
      const refreshed = await refreshAccessToken()
      if (cancelled) return

      if (!refreshed) {
        setStatus("unauthenticated")
        return
      }

      try {
        await loadUser(controller.signal)
      } catch (err) {
        if (cancelled) return
        // A 401 straight after a successful refresh is odd but survivable:
        // treat it as no session. Anything else (network, 500) is also not a
        // session we can act on, so it lands in the same place — the login
        // page — rather than leaving the app stuck on a spinner.
        if (!isApiError(err)) console.error("Session boot failed", err)
        setStatus("unauthenticated")
      }
    }

    void boot()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [loadUser])

  // The client calls this when a request 401s and refreshing could not save it.
  // Registered here so `client.ts` can tear down a session without importing
  // React or knowing about routing.
  React.useEffect(() => {
    setAuthFailureHandler(() => {
      setUser(null)
      setStatus("unauthenticated")
    })
    return () => setAuthFailureHandler(null)
  }, [])

  const refresh = React.useCallback(async () => {
    await loadUser()
  }, [loadUser])

  const signOut = React.useCallback(async () => {
    // `logoutRequest` clears the in-memory token even if the request fails, so
    // the local session is gone regardless of what the server says.
    await logoutRequest()
    setUser(null)
    setStatus("unauthenticated")
    router.replace("/login")
  }, [router])

  const value = React.useMemo<SessionContextValue>(
    () => ({
      status,
      user,
      role: user ? resolveRole(user.roleName) : null,
      refresh,
      signOut,
    }),
    [status, user, refresh, signOut],
  )

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  )
}

export function useSession(): SessionContextValue {
  const context = React.useContext(SessionContext)
  if (context === null) {
    throw new Error("useSession must be used within a SessionProvider")
  }
  return context
}

/**
 * The branch every write on this session is filed against, from `GET /auth/me`.
 *
 * Returns `null` while the session is loading and `null` when the tenant has no
 * active branch. Callers must treat both as "cannot write yet" — an order or a
 * stock adjustment without a branch is a 422, and inventing an id to get past it
 * would file real movements against the wrong place.
 *
 * A hook rather than a prop threaded from the layout because it is read at the
 * point of submission (the POS form, the adjustment dialog) and nowhere in
 * between.
 */
export function useOperatingBranch(): { id: string; name: string } | null {
  const { user } = useSession()
  if (user?.branchId == null) return null
  return { id: user.branchId, name: user.branchName ?? "" }
}
