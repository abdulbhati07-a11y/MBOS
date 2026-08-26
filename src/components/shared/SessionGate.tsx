"use client"

// ---------------------------------------------------------------------------
// src/components/shared/SessionGate.tsx
//
// Holds the dashboard back until the session is known, and bounces to /login
// when there isn't one.
//
// This exists because the access token is deliberately memory-only: every page
// load starts with no token and has to earn one from the refresh cookie. That
// makes "logged in or not?" an async question on first paint, which every
// permission-gated page would otherwise have to answer for itself.
//
// Rendering children while status is "loading" would be the subtle bug worth
// avoiding: `canPerform` would answer from a role nobody has established yet, so
// buttons would flicker in and out as the real role arrives, and a Cashier would
// briefly see Owner controls.
// ---------------------------------------------------------------------------

import * as React from "react"
import { useRouter } from "next/navigation"
import { useSession } from "@/contexts/session-context"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * Stand-in for the dashboard chrome while the session resolves. Deliberately
 * shaped like the real layout (header strip, stat row, table block) so the
 * transition is a fill rather than a jump.
 */
function DashboardSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6" aria-busy="true">
      <span className="sr-only">Loading your session…</span>
      <Skeleton className="h-8 w-64" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-28 w-full" />
        ))}
      </div>
      <Skeleton className="h-96 w-full" />
    </div>
  )
}

export function SessionGate({ children }: { children: React.ReactNode }) {
  const { status } = useSession()
  const router = useRouter()

  // Redirect in an effect rather than during render: navigating while rendering
  // is a side effect React is entitled to discard or repeat.
  React.useEffect(() => {
    if (status === "unauthenticated") router.replace("/login")
  }, [status, router])

  // "unauthenticated" keeps the skeleton rather than rendering null — the
  // redirect above is in flight, and a blank frame reads as a broken page.
  if (status !== "authenticated") return <DashboardSkeleton />

  return <>{children}</>
}
