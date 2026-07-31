import * as React from "react"
import { PageHeader } from "@/components/shared/PageHeader"

export default function TermsPage() {
  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6">
      <PageHeader title="Terms of Service" />
      <p className="text-muted-foreground">
        This is a stub page for the Terms of Service. It will be implemented in a future phase.
      </p>
    </div>
  )
}
