"use client"

import { Pill } from "lucide-react"

import { ModulePlaceholder } from "@/components/shared/ModulePlaceholder"

export default function PharmacyPage() {
  return (
    <ModulePlaceholder
      icon={Pill}
      title="Pharmacy"
      description="Batch and expiry tracking on top of core inventory"
      status="planned"
      planned={[
        "Batch and lot numbers per product, with expiry dates",
        "Expiry alerts feeding the existing low-stock surface",
        "Controlled-substance handling and dispensing records",
      ]}
      footnote={
        <>
          Pharmacy is an <strong>industry add-on</strong>, enabled per tenant
          under Billing and gated by the API on every request (FR-BILL-03).
          Neither the endpoints nor this screen are built yet. Batch tracking
          extends the shared Product and Stock entities — a pharmacy does not get
          a separate product catalogue (Section 1.6).
        </>
      }
    />
  )
}
