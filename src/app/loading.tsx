// ---------------------------------------------------------------------------
// src/app/loading.tsx
//
// Route-segment fallback while a server segment streams. The app's real pages
// are client components that gate on the session, so this mostly shows during
// navigation to / and the auth routes; the dashboard renders its own richer
// skeleton inside SessionGate.
// ---------------------------------------------------------------------------

import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
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
