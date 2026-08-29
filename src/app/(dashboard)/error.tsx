"use client"

// ---------------------------------------------------------------------------
// src/app/(dashboard)/error.tsx
//
// Error boundary for everything inside the AppShell. Pages here are data-heavy
// (orders, reports, inventory) and their failures arrive as thrown query
// errors, so the dashboard needs its own recovery surface that keeps the
// sidebar and header intact — the root boundary would replace the whole chrome,
// which reads like a logout.
//
// Distinct from a 401/403: SessionGate and the permission guards handle those
// before a page renders. What lands here is unexpected — a render throw, a
// server 500.
// ---------------------------------------------------------------------------

import * as React from "react"
import { AlertTriangle, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-md rounded-lg border bg-card p-6 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
          <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden="true" />
        </div>
        <h1 className="text-lg font-semibold">This page could not load</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The data behind this page failed to load. Retry — and if it keeps
          failing, check the API status or reload.
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
