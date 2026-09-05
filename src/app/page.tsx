"use client"

// ---------------------------------------------------------------------------
// src/app/page.tsx
//
// Root route — sends each visitor where they belong.
//
// "Logged in or not?" is an async question on first paint: the access token is
// memory-only, so the answer comes from POST /auth/refresh with the httpOnly
// cookie. This page mounts the session provider's boot sequence (useSession)
// and redirects once the status resolves — /dashboard for an authenticated
// session, /login otherwise. Rendering either destination directly would leave
// the other case showing a flash of the wrong page or a permission error.
//
// This page sits outside the (dashboard) group's SessionGate — it IS the gate
// for the root, doing the same wait-then-redirect with its own two outcomes.
// ---------------------------------------------------------------------------

import * as React from "react"
import { useRouter } from "next/navigation"
import { SessionProvider, useSession } from "@/contexts/session-context"
import { Skeleton } from "@/components/ui/skeleton"

function RootRedirect() {
  const { status } = useSession()
  const router = useRouter()

  // Redirect in an effect rather than during render — same rule as
  // SessionGate: navigating while rendering is a side effect React may
  // discard or repeat.
  React.useEffect(() => {
    if (status === "authenticated") router.replace("/dashboard")
    if (status === "unauthenticated") router.replace("/login")
  }, [status, router])

  // Deliberately bare: this is a waypoint, not a page — anything richer reads
  // as a destination that never arrives.
  return (
    <div
      className="flex min-h-screen items-center justify-center bg-background"
      aria-busy="true"
    >
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-8 w-40" />
    </div>
  )
}

export default function RootPage() {
  // Own provider: this route sits outside the (dashboard) group, whose layout
  // mounts SessionProvider for every other consumer. The boot sequence is
  // single-flight in the API client, so a redirect here and the dashboard's
  // gate never race two refresh rotations.
  return (
    <SessionProvider>
      <RootRedirect />
    </SessionProvider>
  )
}
