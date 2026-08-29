"use client"

// ---------------------------------------------------------------------------
// src/app/error.tsx
//
// Route-level error boundary — Next.js only routes render-time and data-fetch
// throws here; event handlers and effects handle their own errors locally. The
// dashboard group has its own boundary below; this one covers the auth pages
// and anything else outside it.
//
// Client component by requirement: error boundaries need state, and server
// components cannot catch.
// ---------------------------------------------------------------------------

import * as React from "react"
import { AlertTriangle, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-lg border bg-card p-6 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
          <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden="true" />
        </div>
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          An unexpected error occurred. Your work is safe — try again, and if it
          keeps failing, reload the page.
        </p>
        {error.digest ? (
          <p className="mt-3 font-mono text-xs text-muted-foreground/70">
            Reference: {error.digest}
          </p>
        ) : null}
        <Button onClick={reset} className="mt-5">
          <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
          Try again
        </Button>
      </div>
    </div>
  )
}
