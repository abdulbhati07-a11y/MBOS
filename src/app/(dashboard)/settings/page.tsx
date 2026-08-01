"use client"

import * as React from "react"
import { Lock } from "lucide-react"

import { PageHeader } from "@/components/shared/PageHeader"
import { EmptyState } from "@/components/shared/EmptyState"
import { useBreadcrumb } from "@/contexts/breadcrumb-context"
import { useCanPerform } from "@/contexts/role-context"
import { Modules, Actions } from "@/config/permissions"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"

import { CompanyProfileForm } from "@/components/settings/CompanyProfileForm"
import { PermissionMatrixTable } from "@/components/settings/PermissionMatrixTable"

const SETTINGS_CRUMBS = [{ label: "Settings" }] as const

export default function SettingsPage() {
  useBreadcrumb(
    "Settings",
    SETTINGS_CRUMBS as unknown as { label: string; href?: string }[]
  )

  // [PROV-PERM-05] Permission gate — Cashier has no Settings entry in matrix
  const canAccess = useCanPerform(Modules.SETTINGS, Actions.READ)

  if (!canAccess) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Settings"
          description="System and company configuration"
        />
        <EmptyState
          icon={Lock}
          title="Access restricted"
          description="You don't have access to Settings. Contact your manager."
          className="mt-4"
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Settings"
        description="System and company configuration"
      />

      <Tabs defaultValue="company">
        <TabsList>
          <TabsTrigger value="company">Company Profile</TabsTrigger>
          <TabsTrigger value="permissions">Permission Matrix</TabsTrigger>
        </TabsList>

        {/* ── Company Profile tab — [PROV-FR-SET-01] ── */}
        <TabsContent value="company">
          <div className="bg-card border rounded-md p-6">
            <h2 className="text-sm font-medium mb-4">Company Details</h2>
            <CompanyProfileForm />
          </div>
        </TabsContent>

        {/* ── Permission Matrix tab — [PROV-FR-SET-03] ── */}
        <TabsContent value="permissions">
          <div className="bg-card border rounded-md p-6">
            <h2 className="text-sm font-medium mb-4">Role Permissions</h2>
            <PermissionMatrixTable />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
