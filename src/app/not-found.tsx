// ---------------------------------------------------------------------------
// src/app/not-found.tsx
//
// 404 for any unmatched URL outside the dashboard group. The dashboard's own
// chrome cannot render here — the session is unknown and the AppShell needs it
// — so this is deliberately standalone. `notFound()` calls from inside the
// (dashboard) group bubble to this same component unless the group defines its
// own; it does not, and its error boundary above is the wrong shape for a
// missing route.
// ---------------------------------------------------------------------------

import Link from "next/link"

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md text-center">
        <p className="font-mono text-sm text-muted-foreground">404</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">
          Page not found
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you are looking for does not exist or has moved.
        </p>
        <Link
          href="/"
          className="mt-5 inline-block text-sm font-medium text-primary hover:underline"
        >
          Back to MBOS
        </Link>
      </div>
    </div>
  )
}
