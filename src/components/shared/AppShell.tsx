"use client"

import * as React from "react"
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/shared/Sidebar"
import { Separator } from "@/components/ui/separator"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  BreadcrumbProvider,
  useBreadcrumbContext,
} from "@/contexts/breadcrumb-context"
import { RoleProvider, useRole, useSetRole } from "@/contexts/role-context"
import type { Role } from "@/config/permissions"

// ---------------------------------------------------------------------------
// Persona display data — maps role to the Section 3 named persona.
// TODO: replace with real user profile data from auth session (Section 6/7).
// ---------------------------------------------------------------------------
const PERSONA_DISPLAY: Record<Role, { name: string; email: string; initials: string }> = {
  Owner:   { name: "Ayesha R.",  email: "ayesha@mbos.example.com",  initials: "AR" },
  Manager: { name: "Sana M.",    email: "sana@mbos.example.com",    initials: "SM" },
  Cashier: { name: "Bilal K.",   email: "bilal@mbos.example.com",   initials: "BK" },
}

const ROLES: Role[] = ["Owner", "Manager", "Cashier"]

// ---------------------------------------------------------------------------
// Header — reads role from context, exposes the single role toggle
// ---------------------------------------------------------------------------
function AppShellHeader() {
  const { crumbs } = useBreadcrumbContext()
  const role = useRole()
  const setRole = useSetRole()
  const persona = PERSONA_DISPLAY[role]

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b px-4 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
      <div className="flex items-center gap-2">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 h-4" />
        {crumbs.length > 0 && (
          <Breadcrumb>
            <BreadcrumbList>
              {crumbs.map((crumb, index) => {
                const isLast = index === crumbs.length - 1
                return (
                  <React.Fragment key={index}>
                    {index > 0 && (
                      <BreadcrumbSeparator className="hidden md:block" />
                    )}
                    <BreadcrumbItem className={index < crumbs.length - 1 ? "hidden md:block" : ""}>
                      {isLast ? (
                        <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                      ) : (
                        <BreadcrumbLink href={crumb.href || "#"}>
                          {crumb.label}
                        </BreadcrumbLink>
                      )}
                    </BreadcrumbItem>
                  </React.Fragment>
                )
              })}
            </BreadcrumbList>
          </Breadcrumb>
        )}
      </div>

      <div className="flex items-center gap-4">
        {/* Tenant Switcher Stub — unchanged, not in scope for Step 9 */}
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="hidden sm:flex" />}>
            Acme Corp
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Tenants</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Acme Corp (Active)</DropdownMenuItem>
            <DropdownMenuItem>Global Industries</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/*
          Role / Persona toggle — single source of truth for the current role.
          Replaces the five per-page Cashier/Manager Switch toggles.
          TODO: remove once real auth session provides role (Section 6/7).
        */}
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" className="relative h-8 w-8 rounded-full" />}>
            <Avatar className="h-8 w-8">
              <AvatarImage src="" alt={persona.initials} />
              <AvatarFallback>{persona.initials}</AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="end">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">{persona.name}</p>
                <p className="text-xs leading-none text-muted-foreground">
                  {persona.email}
                </p>
                <p className="text-xs leading-none text-muted-foreground mt-1">
                  Role: <span className="font-medium text-foreground">{role}</span>
                </p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Switch Role (demo)
            </DropdownMenuLabel>
            {ROLES.map((r) => (
              <DropdownMenuItem
                key={r}
                onClick={() => setRole(r)}
                className={r === role ? "font-medium" : ""}
              >
                {r}
                {r === role && <span className="ml-auto text-xs text-muted-foreground">active</span>}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem>Settings</DropdownMenuItem>
            <DropdownMenuItem>Log out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}

// ---------------------------------------------------------------------------
// AppShell — wraps everything in RoleProvider then BreadcrumbProvider
// ---------------------------------------------------------------------------
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <RoleProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <BreadcrumbProvider>
            <AppShellHeader />
            <main className="flex flex-1 flex-col p-4 lg:p-6 overflow-auto">
              {children}
            </main>
          </BreadcrumbProvider>
        </SidebarInset>
      </SidebarProvider>
    </RoleProvider>
  )
}
