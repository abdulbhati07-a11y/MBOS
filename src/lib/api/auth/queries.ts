// ---------------------------------------------------------------------------
// src/lib/api/auth/queries.ts
//
// Read side of Section 6.3. There is exactly one: `GET /auth/me`.
//
// These are plain async functions rather than react-query hooks on purpose. The
// session provider calls them imperatively during boot — before any React tree
// that could host a `useQuery` has mounted — and the answer seeds the provider's
// own state. Wrapping it in a hook would put the identity of the current user
// behind the cache that identity is supposed to authorise.
// ---------------------------------------------------------------------------

import { api } from "../client"
import type { CurrentUserResponse } from "../types"

/**
 * The caller's own identity, role and tenant.
 *
 * `@NoModuleRequired` on the backend: it is the endpoint the frontend uses to
 * discover what it may do, so gating it behind a permission would be circular.
 * Requires a valid access token — a 401 here means the session is gone, which
 * the client's refresh-then-retry already tried to fix.
 */
export function fetchCurrentUser(
  signal?: AbortSignal,
): Promise<CurrentUserResponse> {
  return api.get<CurrentUserResponse>("/auth/me", { signal })
}
