"use client"

import { Stethoscope } from "lucide-react"

import { ModulePlaceholder } from "@/components/shared/ModulePlaceholder"

export default function ClinicPage() {
  return (
    <ModulePlaceholder
      icon={Stethoscope}
      title="Clinic"
      description="Patient records, appointments, and procedure billing"
      status="planned"
      planned={[
        "Patient records linked to the shared Customer entity",
        "Appointment scheduling per branch and practitioner",
        "Procedure billing that posts through the normal Sales path",
      ]}
      footnote={
        <>
          Clinic is an <strong>industry add-on</strong>, not part of the core
          platform. The API gates it per tenant through
          {" "}
          <code className="text-xs">TenantModuleSubscription</code>, so a tenant
          only reaches it once the module is enabled under Billing — which takes
          effect on the next request (UC-04). Neither the endpoints nor this
          screen are built yet. Per Section 1.6, the module will extend the
          shared core entities rather than introduce a parallel catalogue.
        </>
      }
    />
  )
}
