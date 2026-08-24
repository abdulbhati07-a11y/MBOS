"use client"

import { CreditCard } from "lucide-react"

import { ModulePlaceholder } from "@/components/shared/ModulePlaceholder"

export default function BillingPage() {
  return (
    <ModulePlaceholder
      icon={CreditCard}
      title="Billing"
      description="Plan, subscription, and industry module add-ons"
      status="api-ready"
      planned={[
        "Show the current plan and billing period",
        "Enable or disable industry modules, taking effect on the next request (UC-04)",
        "Show a prorated charge before a change is confirmed",
      ]}
      footnote={
        <>
          The API for this screen is <strong>already built and tested</strong>{" "}
          (Section 6.10): plan catalogue, current subscription, and the module
          toggle. Two things stand between it and a working page. First, the
          frontend has no API client yet — it still reads mock data. Second, the
          prorated charge is reported as{" "}
          <code className="text-xs">null</code> rather than a number, because no
          per-module price exists and the proration rule (FR-BILL-02) has never
          been written (DEBT-018). Only the three industry modules can be toggled;
          core modules are always available and are never billed separately
          (DEBT-016).
        </>
      }
    />
  )
}
