"use client"

// ---------------------------------------------------------------------------
// src/app/(dashboard)/users/page.tsx
//
// Section 6.5 user management (DEBT-031 — there was no Users page at all). On the
// real API: `GET /users`, paginated server-side and gated on the **settings**
// module, so an Owner and a Manager can both read the roster while a Cashier
// cannot. Every write needs a stronger grant — POST/PATCH want `settings.write`
// and DELETE wants `settings.delete` — which under the built-in matrix makes them
// Owner-only. The controls follow that split: a Manager sees the roster read-only.
//
// "Delete" is a soft delete that also revokes the user's refresh tokens. Three
// self-protections are the server's (own-role change, self-deactivate,
// self-delete); the UI prevents the ones it can — the delete action is hidden for
// your own row, the dialog locks your own role and active toggle — and surfaces
// the server's 403 message if one is reached anyway.
// ---------------------------------------------------------------------------

import * as React from "react"
import { ColumnDef } from "@tanstack/react-table"
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { Plus, Edit, Trash2, Lock } from "lucide-react"

import { PageHeader } from "@/components/shared/PageHeader"
import { DataTable } from "@/components/shared/DataTable"
import { StatusBadge } from "@/components/shared/StatusBadge"
import { ConfirmDialog } from "@/components/shared/ConfirmDialog"
import { EmptyState } from "@/components/shared/EmptyState"
import { useBreadcrumb } from "@/contexts/breadcrumb-context"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useCanPerform } from "@/contexts/role-context"
import { useSession } from "@/contexts/session-context"
import { Modules, Actions } from "@/config/permissions"

import { UserDialog, type UserFormValues } from "@/components/users/UserDialog"

import {
  userKeys,
  fetchUsers,
  type User,
  type UserListParams,
} from "@/lib/api/users/queries"
import { createUser, updateUser, deleteUser } from "@/lib/api/users/mutations"
import { roleKeys, fetchRoles } from "@/lib/api/roles/queries"
import { isApiError } from "@/lib/api/client"

const USERS_CRUMBS = [{ label: "Users" }] as const

const USER_STATUS_VARIANTS: Record<string, "success" | "secondary"> = {
  Active: "success",
  Inactive: "secondary",
}

const PAGE_SIZE = 10

/** A high fixed page for the role picker — it lists options, it does not paginate. */
const ROLE_PICKER_PAGE_SIZE = 100

/** Sentinel for the status filter's "all" option — Select needs a real value. */
const ALL = "all"
type StatusFilter = typeof ALL | "active" | "inactive"

export default function UsersPage() {
  useBreadcrumb(
    "Users",
    USERS_CRUMBS as unknown as { label: string; href?: string }[]
  )

  const queryClient = useQueryClient()

  // settings.read gates the page; write and delete gate the actions on it.
  const canView = useCanPerform(Modules.SETTINGS, Actions.READ)
  const canWrite = useCanPerform(Modules.SETTINGS, Actions.WRITE)
  const canDelete = useCanPerform(Modules.SETTINGS, Actions.DELETE)

  const { user: currentUser } = useSession()
  const currentUserId = currentUser?.id ?? null

  // Row-level failures surface as a banner above the table — there is no toast.
  const [rowError, setRowError] = React.useState<string | null>(null)

  const [page, setPage] = React.useState(0)
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>(ALL)

  const params = React.useMemo<UserListParams>(
    () => ({
      pageIndex: page,
      pageSize: PAGE_SIZE,
      ...(statusFilter === ALL ? {} : { isActive: statusFilter === "active" }),
    }),
    [page, statusFilter]
  )

  const usersQuery = useQuery({
    queryKey: userKeys.list(params),
    queryFn: ({ signal }) => fetchUsers(params, signal),
    enabled: canView,
    placeholderData: keepPreviousData,
  })

  const users = usersQuery.data?.data ?? []
  const pageCount = usersQuery.data?.pagination.pageCount ?? 0

  // Roles for the assignment select. Needed only when a writer opens the dialog,
  // so it is not fetched for a read-only Manager.
  const rolesQuery = useQuery({
    queryKey: roleKeys.list({ pageSize: ROLE_PICKER_PAGE_SIZE }),
    queryFn: ({ signal }) => fetchRoles({ pageSize: ROLE_PICKER_PAGE_SIZE }, signal),
    enabled: canView && canWrite,
  })
  const roles = rolesQuery.data?.data ?? []

  // ── Dialog state ──
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editingUser, setEditingUser] = React.useState<User | undefined>(undefined)

  // ── Mutations ──
  const invalidateUsers = React.useCallback(
    () => queryClient.invalidateQueries({ queryKey: userKeys.all }),
    [queryClient]
  )

  const save = useMutation({
    mutationFn: ({ values, id }: { values: UserFormValues; id?: string }) =>
      id === undefined
        ? createUser({
            email: values.email,
            password: values.password,
            roleId: values.roleId,
            isActive: values.isActive,
          })
        : updateUser(id, {
            email: values.email,
            roleId: values.roleId,
            isActive: values.isActive,
          }),
    onSuccess: (_user, { id }) => {
      setRowError(null)
      void invalidateUsers()
      if (id === undefined) setPage(0)
    },
    // No onError: the dialog awaits mutateAsync and maps the ApiError onto fields.
  })

  const handleSaveUser = (values: UserFormValues, id?: string) =>
    save.mutateAsync({ values, id })

  const del = useMutation({
    mutationFn: (id: string) => deleteUser(id),
    onSuccess: () => {
      setRowError(null)
      void invalidateUsers()
    },
    onError: (err) => {
      if (isApiError(err) && err.isForbidden) {
        // Self-delete is the expected 403 here and its message says so.
        setRowError(err.message || "You cannot delete your own account.")
        return
      }
      setRowError(
        isApiError(err)
          ? err.message
          : "Could not delete that user — the server did not respond."
      )
    },
  })

  // ── Handlers ──
  const handleAddUser = () => {
    setEditingUser(undefined)
    setDialogOpen(true)
  }

  const handleEditUser = (user: User) => {
    setEditingUser(user)
    setDialogOpen(true)
  }

  // ---------------------------------------------------------------------------
  // Columns
  // ---------------------------------------------------------------------------
  const columns = React.useMemo<ColumnDef<User>[]>(
    () => [
      {
        accessorKey: "email",
        header: "Email",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span className="font-medium">{row.original.email}</span>
            {row.original.id === currentUserId && (
              <span className="text-xs text-muted-foreground">(you)</span>
            )}
          </div>
        ),
      },
      {
        accessorKey: "roleName",
        header: "Role",
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => (
          <StatusBadge
            status={row.original.isActive ? "Active" : "Inactive"}
            variantMap={USER_STATUS_VARIANTS}
          />
        ),
      },
      {
        id: "mfa",
        header: "2FA",
        cell: ({ row }) =>
          row.original.mfaEnabled ? (
            "Enabled"
          ) : (
            <span className="text-muted-foreground">Off</span>
          ),
      },
      {
        accessorKey: "createdAt",
        header: "Added",
        cell: ({ row }) =>
          new Date(row.original.createdAt).toLocaleDateString("en-US", {
            dateStyle: "medium",
          }),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const user = row.original
          if (!canWrite && !canDelete) return null
          const isSelf = user.id === currentUserId
          const busy = del.isPending && del.variables === user.id
          return (
            <div className="flex items-center gap-1 justify-end">
              {canWrite && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleEditUser(user)}
                >
                  <Edit className="h-4 w-4 mr-1" />
                  Edit
                </Button>
              )}
              {/* Delete is hidden for your own row — the server forbids it, and
                  hiding it is clearer than offering an action that always fails. */}
              {canDelete && !isSelf && (
                <ConfirmDialog
                  trigger={
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      disabled={busy}
                    >
                      <Trash2 className="h-4 w-4 mr-1" />
                      Delete
                    </Button>
                  }
                  title="Delete user?"
                  description={`${user.email} will lose access immediately and any active sessions are revoked. This can be undone by re-creating the user.`}
                  confirmLabel="Delete"
                  variant="destructive"
                  onConfirm={() => del.mutate(user.id)}
                />
              )}
            </div>
          )
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canWrite, canDelete, currentUserId, del.isPending, del.variables]
  )

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <PageHeader title="Users" description="Manage who can sign in and what they can do" />
        {canWrite && (
          <Button onClick={handleAddUser}>
            <Plus className="mr-2 h-4 w-4" />
            Add User
          </Button>
        )}
      </div>

      {!canView ? (
        <EmptyState
          icon={Lock}
          title="Access restricted"
          description="You don't have access to user management. Contact your manager."
          className="mt-4"
        />
      ) : (
        <div className="space-y-4">
          <div className="max-w-[12rem]">
            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter((v as StatusFilter | null) ?? ALL)
                setPage(0)
              }}
            >
              <SelectTrigger className="w-full" aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All users</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {rowError !== null && (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {rowError}
            </p>
          )}

          <div className="bg-card border rounded-md p-4">
            {usersQuery.isError ? (
              <div className="space-y-3 py-8 text-center">
                <p role="alert" className="text-sm text-destructive">
                  {isApiError(usersQuery.error) && usersQuery.error.isForbidden
                    ? "You do not have permission to view users."
                    : "Could not load users."}
                </p>
                {!(isApiError(usersQuery.error) && usersQuery.error.isForbidden) && (
                  <Button variant="outline" onClick={() => void usersQuery.refetch()}>
                    Try again
                  </Button>
                )}
              </div>
            ) : (
              <DataTable
                columns={columns}
                data={users}
                isLoading={usersQuery.isPending}
                pageIndex={page}
                pageSize={PAGE_SIZE}
                pageCount={pageCount}
                onPageChange={setPage}
              />
            )}
          </div>
        </div>
      )}

      {/* ── Create / edit dialog ── */}
      <UserDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        user={editingUser}
        roles={roles}
        rolesLoading={rolesQuery.isPending}
        isSelf={editingUser !== undefined && editingUser.id === currentUserId}
        onSave={handleSaveUser}
      />
    </div>
  )
}
