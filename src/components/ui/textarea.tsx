import * as React from "react"

import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// src/components/ui/textarea.tsx
//
// The first multi-line input in the app. Added for the refund reason, where the
// text is a sentence or two of audit trail rather than a value, and a single-line
// `Input` would hide most of what was typed.
//
// `@base-ui/react` has no textarea primitive — its `Input` is input-only — so this
// wraps the native element and borrows `Input`'s classes verbatim, minus the fixed
// height and the `file:` rules that cannot apply. Keeping the two visually
// identical is the point: a form should not look like it mixes two input kits.
// ---------------------------------------------------------------------------

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "field-sizing-content min-h-16 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
