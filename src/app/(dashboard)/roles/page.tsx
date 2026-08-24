"use client"

import { ShieldAlert } from "lucide-react"

import { ModulePlaceholder } from "@/components/shared/ModulePlaceholder"

export default function RolesPage() {
  return (
    <ModulePlaceholder
      icon={ShieldAlert}
      title="Roles"
      description="Built-in roles and custom permission sets"
      status="api-ready"
      planned={[
        "List the three built-in roles alongside this tenant's custom roles",
        "Create and delete custom roles (FR-SET-02)",
        "Edit a role's permission grid — every module against read, write, delete, and refund",
      ]}
      footnote={
        <>
          The API for this screen is <strong>already built and tested</strong>{" "}
          (Section 6.5): roles list, create, delete, and the full permission grid
          behind <code className="text-xs">GET/PUT /roles/:id/permissions</code>.
          What is missing is the frontend API client — the app still reads mock
          data and makes no HTTP calls, so there is nothing yet to render the real
          matrix with. Until then the permission matrix in{" "}
          <code className="text-xs">src/config/permissions.ts</code> is the
          frontend&apos;s own copy (DEBT-006), and built-in roles are global and
          not editable by design (D-02).
        </>
      }
    />
  )
}
