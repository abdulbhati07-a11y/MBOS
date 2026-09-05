// ---------------------------------------------------------------------------
// src/app/(dashboard)/layout.tsx
//
// Provider order is load-bearing, outside in:
//
//   QueryProvider     the request cache. Outermost because it must survive every
//                     navigation *and* the session boot below — a query fired
//                     during the boot sequence needs a client already mounted.
//                     It holds no user data of its own, so it is safe above the
//                     gate.
//   SessionProvider   establishes who the user is. Must be above the gate — the
//                     gate and RoleProvider inside AppShell both read it.
//   SessionGate       holds everything back until that answer arrives, and
//                     redirects to /login when there is no session. Placed
//                     outside AppShell so a logged-out visitor never sees the
//                     sidebar and header flash before the redirect lands.
//
// The former Orders/Products mock-data contexts are gone: every page reads
// through TanStack Query against the live API, and a page that writes
// invalidates the affected queries rather than mutating a React store.
//
// This layout stays a Server Component. Each provider carries its own
// "use client" boundary, which is the documented way to use context under the
// App Router.
// ---------------------------------------------------------------------------

import { AppShell } from "@/components/shared/AppShell"
import { SessionGate } from "@/components/shared/SessionGate"
import { QueryProvider } from "@/components/providers/QueryProvider"
import { SessionProvider } from "@/contexts/session-context"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <QueryProvider>
      <SessionProvider>
        <SessionGate>
          <AppShell>{children}</AppShell>
        </SessionGate>
      </SessionProvider>
    </QueryProvider>
  )
}
