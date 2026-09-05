"use client"

// ---------------------------------------------------------------------------
// src/components/providers/QueryProvider.tsx
//
// Mounts TanStack Query for the whole dashboard.
//
// Client component, and it has to be: QueryClient holds mutable cache state and
// subscriptions, so it cannot cross the server/client boundary. The layout that
// renders this stays a Server Component — only this file and its subtree are
// client-side.
// ---------------------------------------------------------------------------

import * as React from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { ApiError } from "@/lib/api/client"

/**
 * How many times a failed query is retried.
 *
 * Retrying a 4xx is pointless and occasionally harmful: a 403 will be a 403 next
 * time, a 422 names a field the caller got wrong, and a 429 retried three times
 * in quick succession is how a rate limit becomes a lockout. Only 5xx and
 * transport failures are worth another attempt.
 *
 * 401 is deliberately in the do-not-retry set even though it *is* recoverable —
 * `request()` already refreshes the access token and replays the call once
 * itself, so an ApiError with status 401 reaching this point means the refresh
 * also failed and the session is over. Retrying would hammer a dead session.
 */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status < 500) return false
  return failureCount < 2
}

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        /**
         * 30 seconds. Long enough that moving between the dashboard and a list
         * does not refetch everything, short enough that a colleague's edit shows
         * up without a manual reload. Reads that must be current — stock levels
         * during a sale — override this at the call site rather than lowering it
         * for everything.
         */
        staleTime: 30_000,
        /**
         * Off. A back-office app sits on an idle tab for hours, and refetching
         * every list on each window focus turns that into a burst of requests
         * against a rate-limited API for data nobody is looking at.
         */
        refetchOnWindowFocus: false,
      },
      mutations: {
        // Never retry a write. Order creation and stock adjustments are not
        // idempotent — a retried POST /orders that actually succeeded the first
        // time books the sale twice, and BR-03 means neither copy can be deleted.
        retry: false,
      },
    },
  })
}

/**
 * The browser's client, created once.
 *
 * A module-level singleton rather than `useState(() => new QueryClient())`
 * because this provider is mounted by a layout that persists across every
 * dashboard navigation, so there is no remount to guard against — and a
 * module-level client keeps the cache alive if React ever does remount it.
 *
 * It is created lazily on first use, not at import time, so importing this
 * module during a server render does not allocate a client that would then be
 * shared between two users' requests.
 */
let browserQueryClient: QueryClient | undefined

function getQueryClient(): QueryClient {
  if (typeof window === "undefined") {
    // Server render: a fresh client every time. Sharing one across requests
    // would leak one tenant's cached rows into another tenant's page.
    return createQueryClient()
  }
  browserQueryClient ??= createQueryClient()
  return browserQueryClient
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(getQueryClient)

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}
