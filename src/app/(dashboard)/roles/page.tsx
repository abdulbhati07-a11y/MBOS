"use client"

// ---------------------------------------------------------------------------
// src/app/(dashboard)/roles/page.tsx
//
// Section 6.5 roles — finally the REAL permission matrix (DEBT-006/DEBT-007).
// Until now this screen was a placeholder and the app answered permission checks
// from the client-side `DEFAULT_ROLE_PERMISSIONS` guess; here it reads the
// server's grid over `GET /roles` and `GET /roles/:id/permissions`, both gated on
// the **settings** module, and writes it back with `PUT /roles/:id/permissions`.
//
// The grid renders from the server's OWN keys, not the frontend `Modules` enum,
// because the server's taxonomy includes `billing` (which the enum has no member
// for) and grants `refund` on `sales` alone. A fixed enum would silently drop
// exactly the pairs a permissions editor must be honest about, so modules and
// actions are both derived from whatever the response contains, and a pair the
// grid doesn't include (e.g. `inventory.refund`) shows as not-applicable.
//
// Built-in roles are global and read-only by design (D-02): the server answers
// 403 to editing or deleting one, and the UI mirrors that — their checkboxes are
// disabled and they carry no delete control. A custom role edits into a draft and
// saves the WHOLE grid at once (the PUT is a replace, not a patch); deleting one
// still held by users is a 409, surfaced as a banner.
// ---------------------------------------------------------------------------

import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useForm, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Lock, Plus, Trash2 } from "lucide-react"

import { PageHeader } from "@/components/shared/PageHeader"
import { EmptyState } from "@/components/shared/EmptyState"
import { ConfirmDialog } from "@/components/shared/ConfirmDialog"
import { useBreadcrumb } from "@/contexts/breadcrumb-context"
import { useCanPerform } from "@/contexts/role-context"
import { Modules, Actions } from "@/config/permissions"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { cn } from "@/lib/utils"

import {
  roleKeys,
  fetchRoles,
  fetchRolePermissions,
  type RoleSummary,
  type PermissionEntry,
} from "@/lib/api/roles/queries"
import {
  createRole,
  deleteRole,
  replaceRolePermissions,
} from "@/lib/api/roles/mutations"
import { createRoleSchema, type CreateRoleValues } from "@/lib/validation/users"
import { isApiError } from "@/lib/api/client"

const ROLES_CRUMBS = [{ label: "Roles" }] as const

/** Roles are few; one high page lists them all rather than paginating. */
const ROLE_PAGE_SIZE = 100

/** Column order for the known actions; anything else the server sends is appended. */
const ACTION_ORDER = ["read", "write", "delete", "refund"]

function permKey(module: string, action: string): string {
  return `${module}:${action}`
}

function labelize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

// ---------------------------------------------------------------------------
// Create-role dialog — name only; the grid is edited afterwards.
// ---------------------------------------------------------------------------
function CreateRoleForm({
  onCreated,
  onDone,
}: {
  onCreated: (role: RoleSummary) => void
  onDone: () => void
}) {
  const [formError, setFormError] = React.useState<string | null>(null)

  const form = useForm<CreateRoleValues>({
    resolver: zodResolver(createRoleSchema) as unknown as Resolver<CreateRoleValues>,
    defaultValues: { name: "" },
  })

  const onSubmit = async (data: CreateRoleValues) => {
    setFormError(null)
    try {
      const role = await createRole({ name: data.name })
      onCreated(role)
      onDone()
    } catch (err) {
      if (!isApiError(err)) {
        setFormError("Could not reach the server. The role was not created.")
        return
      }
      if (err.isConflict) {
        form.setError("name", {
          type: "server",
          message: "A role with that name already exists.",
        })
        return
      }
      if (err.isValidation) {
        const fieldErrors = err.fieldErrors()
        if (fieldErrors.name) {
          form.setError("name", { type: "server", message: fieldErrors.name })
          return
        }
        setFormError(err.message)
        return
      }
      if (err.isForbidden) {
        setFormError("You do not have permission to create roles.")
        return
      }
      setFormError(err.message)
    }
  }

  const saving = form.formState.isSubmitting

  return (
    <>
      <DialogHeader>
        <DialogTitle>New role</DialogTitle>
        <DialogDescription>
          Create a custom role, then set its permissions on the grid.
        </DialogDescription>
      </DialogHeader>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Role name</FormLabel>
                <FormControl>
                  <Input
                    placeholder="e.g. Shift Supervisor"
                    autoComplete="off"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {formError !== null && (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {formError}
            </p>
          )}

          <DialogFooter>
            <DialogClose
              render={
                <Button type="button" variant="outline" disabled={saving}>
                  Cancel
                </Button>
              }
            />
            <Button type="submit" disabled={saving}>
              {saving ? "Creating…" : "Create role"}
            </Button>
          </DialogFooter>
        </form>
      </Form>
    </>
  )
}

export default function RolesPage() {
  useBreadcrumb(
    "Roles",
    ROLES_CRUMBS as unknown as { label: string; href?: string }[]
  )

  const queryClient = useQueryClient()

  const canView = useCanPerform(Modules.SETTINGS, Actions.READ)
  const canManage = useCanPerform(Modules.SETTINGS, Actions.WRITE)
  const canDelete = useCanPerform(Modules.SETTINGS, Actions.DELETE)

  const [rowError, setRowError] = React.useState<string | null>(null)
  const [selectedRoleId, setSelectedRoleId] = React.useState<string | null>(null)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [draft, setDraft] = React.useState<Record<string, boolean>>({})

  const rolesQuery = useQuery({
    queryKey: roleKeys.list({ pageSize: ROLE_PAGE_SIZE }),
    queryFn: ({ signal }) => fetchRoles({ pageSize: ROLE_PAGE_SIZE }, signal),
    enabled: canView,
  })
  const roles = rolesQuery.data?.data ?? []

  // Default the selection to the first role, and recover the selection if the one
  // held was just deleted. Functional update keeps `selectedRoleId` out of deps.
  React.useEffect(() => {
    const list = rolesQuery.data?.data
    if (!list || list.length === 0) return
    setSelectedRoleId((prev) =>
      prev && list.some((r) => r.id === prev) ? prev : list[0].id
    )
  }, [rolesQuery.data])

  const permsQuery = useQuery({
    queryKey: selectedRoleId
      ? roleKeys.permission(selectedRoleId)
      : roleKeys.permissions(),
    queryFn: ({ signal }) =>
      fetchRolePermissions(selectedRoleId as string, signal),
    enabled: canView && selectedRoleId !== null,
  })
  const perms = permsQuery.data ?? []

  // Seed the editable draft whenever a role's grid arrives — including after a
  // save invalidates and refetches it, which is what clears the dirty state.
  React.useEffect(() => {
    const data = permsQuery.data
    if (!data) return
    setDraft(
      Object.fromEntries(data.map((p) => [permKey(p.module, p.action), p.granted]))
    )
  }, [permsQuery.data])

  const selectedRole = roles.find((r) => r.id === selectedRoleId)
  const isBuiltIn = selectedRole?.isBuiltIn ?? false
  const editable = selectedRole !== undefined && !isBuiltIn && canManage

  // Rows and columns are the server's own keys, in first-seen (grid) order for
  // modules and canonical order for actions.
  const modules = React.useMemo(() => {
    const seen: string[] = []
    for (const p of perms) if (!seen.includes(p.module)) seen.push(p.module)
    return seen
  }, [perms])

  const actions = React.useMemo(() => {
    const present = new Set(perms.map((p) => p.action))
    const known = ACTION_ORDER.filter((a) => present.has(a))
    const extra = [...present].filter((a) => !ACTION_ORDER.includes(a)).sort()
    return [...known, ...extra]
  }, [perms])

  const pairExists = React.useMemo(() => {
    const s = new Set<string>()
    for (const p of perms) s.add(permKey(p.module, p.action))
    return s
  }, [perms])

  const dirty = React.useMemo(
    () =>
      perms.some(
        (p) => (draft[permKey(p.module, p.action)] ?? p.granted) !== p.granted
      ),
    [perms, draft]
  )

  // ── Mutations ──
  const savePerms = useMutation({
    mutationFn: () => {
      // Echo the exact grid the GET returned with the booleans edited — sending
      // the `false` rows too is expected and can't trip the meaningless-pair 422.
      const payload: PermissionEntry[] = perms.map((p) => ({
        module: p.module,
        action: p.action,
        granted: draft[permKey(p.module, p.action)] ?? p.granted,
      }))
      return replaceRolePermissions(selectedRoleId as string, payload)
    },
    onSuccess: () => {
      setRowError(null)
      if (selectedRoleId) {
        void queryClient.invalidateQueries({
          queryKey: roleKeys.permission(selectedRoleId),
        })
      }
    },
    onError: (err) => {
      if (isApiError(err) && err.isForbidden) {
        setRowError(
          "You can't edit this role — built-in roles are read-only, and saving needs the settings write permission."
        )
        return
      }
      setRowError(
        isApiError(err)
          ? err.message
          : "Could not save permissions — the server did not respond."
      )
    },
  })

  const removeRole = useMutation({
    mutationFn: (id: string) => deleteRole(id),
    onSuccess: (_role, id) => {
      setRowError(null)
      if (selectedRoleId === id) setSelectedRoleId(null)
      void queryClient.invalidateQueries({ queryKey: roleKeys.lists() })
    },
    onError: (err) => {
      if (isApiError(err) && err.isConflict) {
        setRowError(
          "That role is still assigned to one or more users. Reassign them before deleting it."
        )
        return
      }
      if (isApiError(err) && err.isForbidden) {
        setRowError("Built-in roles can't be deleted.")
        return
      }
      setRowError(
        isApiError(err)
          ? err.message
          : "Could not delete that role — the server did not respond."
      )
    },
  })

  // ── Handlers ──
  const toggle = (module: string, action: string, granted: boolean) => {
    setDraft((prev) => ({ ...prev, [permKey(module, action)]: granted }))
  }

  const resetDraft = () => {
    setDraft(
      Object.fromEntries(perms.map((p) => [permKey(p.module, p.action), p.granted]))
    )
  }

  const handleRoleCreated = (role: RoleSummary) => {
    void queryClient.invalidateQueries({ queryKey: roleKeys.lists() })
    setSelectedRoleId(role.id)
  }

  const gridReady =
    selectedRole !== undefined && !permsQuery.isPending && !permsQuery.isError

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  if (!canView) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Roles" description="Built-in roles and custom permission sets" />
        <EmptyState
          icon={Lock}
          title="Access restricted"
          description="You don't have access to roles. Contact your manager."
          className="mt-4"
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Roles"
        description="Built-in roles and this tenant's custom permission sets"
      />

      {rowError !== null && (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {rowError}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        {/* ── Roles list ── */}
        <Card className="h-fit">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>Roles</CardTitle>
              {canManage && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCreateOpen(true)}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  New
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-1">
            {rolesQuery.isPending ? (
              <>
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
              </>
            ) : rolesQuery.isError ? (
              <div className="space-y-3 py-4 text-center">
                <p role="alert" className="text-sm text-destructive">
                  {isApiError(rolesQuery.error) && rolesQuery.error.isForbidden
                    ? "You do not have permission to view roles."
                    : "Could not load roles."}
                </p>
                {!(isApiError(rolesQuery.error) && rolesQuery.error.isForbidden) && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void rolesQuery.refetch()}
                  >
                    Try again
                  </Button>
                )}
              </div>
            ) : roles.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No roles found.
              </p>
            ) : (
              roles.map((role) => {
                const selected = role.id === selectedRoleId
                return (
                  <div
                    key={role.id}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-md px-3 py-2 transition-colors",
                      selected ? "bg-muted" : "hover:bg-muted/50"
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedRoleId(role.id)}
                      className="flex-1 truncate text-left text-sm font-medium"
                    >
                      {role.name}
                    </button>
                    {role.isBuiltIn ? (
                      <Badge variant="secondary">Built-in</Badge>
                    ) : canDelete ? (
                      <ConfirmDialog
                        trigger={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground hover:text-destructive"
                            disabled={
                              removeRole.isPending &&
                              removeRole.variables === role.id
                            }
                            aria-label={`Delete ${role.name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        }
                        title="Delete role?"
                        description={`${role.name} will be removed. Users must be reassigned first, or the delete is refused.`}
                        confirmLabel="Delete"
                        variant="destructive"
                        onConfirm={() => removeRole.mutate(role.id)}
                      />
                    ) : (
                      <Badge variant="outline">Custom</Badge>
                    )}
                  </div>
                )
              })
            )}
          </CardContent>
        </Card>

        {/* ── Permission grid ── */}
        <Card>
          <CardHeader>
            <CardTitle>{selectedRole ? selectedRole.name : "Permissions"}</CardTitle>
            <CardDescription>
              {isBuiltIn
                ? "Built-in roles are global and read-only (D-02)."
                : editable
                  ? "Tick an action to grant it, then save to apply the whole grid."
                  : "You have read-only access to the permission matrix."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!selectedRole || permsQuery.isPending ? (
              <div className="space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : permsQuery.isError ? (
              <div className="space-y-3 py-6 text-center">
                <p role="alert" className="text-sm text-destructive">
                  {isApiError(permsQuery.error) && permsQuery.error.isForbidden
                    ? "You do not have permission to view this role's grid."
                    : "Could not load the permission grid."}
                </p>
                {!(isApiError(permsQuery.error) && permsQuery.error.isForbidden) && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void permsQuery.refetch()}
                  >
                    Try again
                  </Button>
                )}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Module</TableHead>
                    {actions.map((action) => (
                      <TableHead key={action} className="text-center">
                        {labelize(action)}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {modules.map((module) => (
                    <TableRow key={module}>
                      <TableCell className="font-medium">
                        {labelize(module)}
                      </TableCell>
                      {actions.map((action) => {
                        const key = permKey(module, action)
                        if (!pairExists.has(key)) {
                          return (
                            <TableCell
                              key={action}
                              className="text-center text-muted-foreground"
                            >
                              —
                            </TableCell>
                          )
                        }
                        return (
                          <TableCell key={action} className="text-center">
                            <div className="flex justify-center">
                              <Checkbox
                                checked={draft[key] ?? false}
                                disabled={!editable || savePerms.isPending}
                                onCheckedChange={(checked) =>
                                  toggle(module, action, checked === true)
                                }
                                aria-label={`${labelize(action)} ${labelize(module)}`}
                              />
                            </div>
                          </TableCell>
                        )
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {editable && gridReady && (
              <div className="mt-4 flex items-center justify-end gap-2 border-t pt-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={resetDraft}
                  disabled={!dirty || savePerms.isPending}
                >
                  Reset
                </Button>
                <Button
                  size="sm"
                  onClick={() => savePerms.mutate()}
                  disabled={!dirty || savePerms.isPending}
                >
                  {savePerms.isPending ? "Saving…" : "Save changes"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Create-role dialog ── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-sm">
          <CreateRoleForm
            onCreated={handleRoleCreated}
            onDone={() => setCreateOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}
