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
import { useSession } from "@/contexts/session-context"
import type { Role } from "@/config/permissions"

/** Roles the dev-only override can switch between. */
const ROLES: Role[] = ["Owner", "Manager", "Cashier"]

/**
 * Whether to offer the role override. The seed creates exactly one user — an
 * Owner — so without this there is no way to eyeball the Manager and Cashier
 * variants of a screen. It is a display-layer lie by construction: it changes
 * what the UI offers, never what the API permits, so a Cashier-mode Owner still
 * has Owner rights on every request. That is the whole reason it must not ship.
 */
const ALLOW_ROLE_OVERRIDE = process.env.NODE_ENV !== "production"

/**
 * Two letters for the avatar, taken from the email's local part — the API
 * returns no display name, and inventing one would put a fake identity next to
 * a real session.
 */
function initialsFromEmail(email: string): string {
  const local = email.split("@")[0] ?? ""
  const letters = local.replace(/[^a-zA-Z0-9]/g, "")
  return (letters.slice(0, 2) || "??").toUpperCase()
}

// ---------------------------------------------------------------------------
// Header — identity comes from the session; role comes from RoleProvider, which
// the session seeded. Those are two different questions: `user.roleName` is what
// the server says the user is, while `useRole()` is what the UI is currently
// rendering for, and in dev those can differ by the override below.
// ---------------------------------------------------------------------------
function AppShellHeader() {
  const { crumbs } = useBreadcrumbContext()
  const { user, signOut } = useSession()
  const role = useRole()
  const setRole = useSetRole()

  const email = user?.email ?? ""
  const initials = email ? initialsFromEmail(email) : "??"
  const actualRole = user?.roleName ?? role
  const isOverridden = actualRole !== role

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
        {/* Branch Switcher stub — renamed from "Tenant Switcher" per Section 5
            decision: one user belongs to one tenant; this control selects among
            branches within the same tenant. Real implementation pending Branch
            data model (Section 5 / FR-TEN-02). */}
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="hidden sm:flex" />}>
            Main Branch
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Branches</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Main Branch (Active)</DropdownMenuItem>
            <DropdownMenuItem>Warehouse Branch</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" className="relative h-8 w-8 rounded-full" />}>
            <Avatar className="h-8 w-8">
              <AvatarImage src="" alt={initials} />
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="end">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">{email}</p>
                <p className="text-xs leading-none text-muted-foreground mt-1">
                  Role: <span className="font-medium text-foreground">{actualRole}</span>
                </p>
                {isOverridden && (
                  <p className="text-xs leading-none text-muted-foreground">
                    Viewing as: <span className="font-medium text-foreground">{role}</span>
                  </p>
                )}
              </div>
            </DropdownMenuLabel>

            {ALLOW_ROLE_OVERRIDE && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  View as role (dev only — does not change API access)
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
              </>
            )}

            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void signOut()}>
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}

// ---------------------------------------------------------------------------
// AppShell — seeds RoleProvider from the session, then the usual chrome.
//
// AppShell only ever mounts inside SessionGate, so `user` is already resolved on
// first render and `initialRole` lands before any child asks `canPerform`. That
// ordering is what makes a one-shot `initialRole` sufficient here rather than
// needing the provider to track later changes.
//
// `roleName` is passed through as-is instead of being validated against the
// three built-ins. A name the matrix has no entry for makes `canPerform` return
// false for every module — the UI fails closed on its own, which is the right
// answer for a custom role (FR-SET-02) this build cannot yet describe.
// ---------------------------------------------------------------------------
export function AppShell({ children }: { children: React.ReactNode }) {
  const { user } = useSession()

  return (
    <RoleProvider initialRole={user?.roleName as Role | undefined}>
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
