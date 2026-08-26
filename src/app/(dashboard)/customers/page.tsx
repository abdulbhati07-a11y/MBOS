"use client"

// ---------------------------------------------------------------------------
// src/app/(dashboard)/customers/page.tsx
//
// On the real API: `GET /customers` with server-side pagination and search.
//
// Two columns were **removed** rather than ported: "Orders" and "Total Spend".
// Both were computed by filtering the in-memory orders context, and neither
// survives the move to a paginated API:
//
//   - the list endpoint returns no order aggregates, so filling them per row means
//     one `GET /customers/:id` per row — an N+1 on every page turn;
//   - a spend figure summed from whatever orders the client happens to hold is
//     wrong in the direction of *understating* what a customer is worth, and a
//     wrong money figure on screen is worse than no figure.
//
// A real lifetime-spend needs a server-side aggregate plus a decision about
// whether Pending and Refunded orders count toward it. Until both exist, the
// detail dialog shows the true order count from `pagination.total` and no total.
//
// Search is new UI, and it is not optional: with the list paginated server-side,
// scanning for a customer by scrolling is no longer possible past page one.
//
// "Deactivate" is `PATCH { isActive: false }`, not `DELETE`. They are different
// operations — DELETE soft-deletes and the record leaves the list entirely, while
// deactivating keeps it visible and badged, which is what the confirm copy has
// always promised. It also keeps the action inside `customers.write`, so a Manager
// can do it; `customers.delete` is Owner-only.
// ---------------------------------------------------------------------------

import * as React from "react"
import { ColumnDef } from "@tanstack/react-table"
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { Plus, Edit, UserX, UserCheck, Eye, Search } from "lucide-react"

import { PageHeader } from "@/components/shared/PageHeader"
import { DataTable } from "@/components/shared/DataTable"
import { StatusBadge } from "@/components/shared/StatusBadge"
import { ConfirmDialog } from "@/components/shared/ConfirmDialog"
import { useBreadcrumb } from "@/contexts/breadcrumb-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useCanPerform } from "@/contexts/role-context"
import { Modules, Actions } from "@/config/permissions"

import { CustomerDrawer } from "@/components/customers/CustomerDrawer"
import { CustomerDetailDialog } from "@/components/customers/CustomerDetailDialog"
import {
  customerKeys,
  fetchCustomers,
  type Customer,
  type CustomerListParams,
} from "@/lib/api/customers/queries"
import {
  createCustomer,
  updateCustomer,
} from "@/lib/api/customers/mutations"
import { isApiError } from "@/lib/api/client"
import { CustomerValues } from "@/lib/validation/customers"

const CUSTOMERS_CRUMBS = [{ label: "Customers" }] as const

const CUSTOMER_STATUS_VARIANTS: Record<string, "success" | "secondary"> = {
  Active: "success",
  Inactive: "secondary",
}

const PAGE_SIZE = 10

/** How long typing settles before a request goes out. */
const SEARCH_DEBOUNCE_MS = 300

export default function CustomersPage() {
  useBreadcrumb(
    "Customers",
    CUSTOMERS_CRUMBS as unknown as { label: string; href?: string }[]
  )

  const queryClient = useQueryClient()

  // [PROV-PERM-03] Permission via RoleContext
  const canManage = useCanPerform(Modules.CUSTOMERS, Actions.WRITE)

  const [pageIndex, setPageIndex] = React.useState(0)

  // Two pieces of state for one box: what is in the input, and what has been
  // asked of the server. Debouncing the second keeps a five-letter name from
  // firing five requests, four of which are already stale on arrival.
  const [searchInput, setSearchInput] = React.useState("")
  const [search, setSearch] = React.useState("")

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim())
      setPageIndex(0)
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [searchInput])

  const params = React.useMemo<CustomerListParams>(
    () => ({
      pageIndex,
      pageSize: PAGE_SIZE,
      ...(search === "" ? {} : { search }),
    }),
    [pageIndex, search]
  )

  const customersQuery = useQuery({
    queryKey: customerKeys.list(params),
    queryFn: ({ signal }) => fetchCustomers(params, signal),
    // Hold the previous page's rows while the next one loads. Without this the
    // table empties and re-fills on every page turn and every keystroke that
    // settles, which reads as data loss rather than loading.
    placeholderData: keepPreviousData,
  })

  const customers = customersQuery.data?.data ?? []
  const pageCount = customersQuery.data?.pagination.pageCount ?? 0
  const total = customersQuery.data?.pagination.total

  // No page clamp here, deliberately. `pageIndex` can only go out of range if the
  // result set shrinks under it, and nothing here shrinks it: narrowing the search
  // resets to page 0 in the debounce above, and deactivating is a status flip on a
  // row that stays in the list (this endpoint has no active-only filter). Growing
  // `pageIndex` is already bounded — `DataTable` disables Next on the last page.

  // Drawer state
  const [drawerOpen, setDrawerOpen] = React.useState(false)
  const [editingCustomer, setEditingCustomer] = React.useState<
    Customer | undefined
  >(undefined)

  // Detail dialog state
  const [detailCustomer, setDetailCustomer] = React.useState<Customer | null>(
    null
  )
  const [detailOpen, setDetailOpen] = React.useState(false)

  // Row-level failures have nowhere to go — there is no toast in this app — so
  // they surface as a banner above the table.
  const [rowError, setRowError] = React.useState<string | null>(null)

  const handleAddCustomer = () => {
    setEditingCustomer(undefined)
    setDrawerOpen(true)
  }

  const handleEditCustomer = (customer: Customer) => {
    setEditingCustomer(customer)
    setDrawerOpen(true)
  }

  const handleViewDetail = (customer: Customer) => {
    setDetailCustomer(customer)
    setDetailOpen(true)
  }

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  /**
   * Invalidating the whole `["customers"]` prefix rather than just the current
   * list key. An edit can change whether a row matches the active search, or
   * where it sorts, on any cached page — and the open detail dialog reads the
   * same record. One prefix call covers all of it; anything narrower leaves a
   * stale row somewhere the user can navigate back to.
   */
  const invalidateCustomers = React.useCallback(
    () => queryClient.invalidateQueries({ queryKey: customerKeys.all }),
    [queryClient]
  )

  const save = useMutation({
    mutationFn: ({ values, id }: { values: CustomerValues; id?: string }) => {
      const payload = {
        name: values.name,
        email: values.email,
        phone: values.phone,
        address: values.address,
        notes: values.notes,
      }
      // `isActive` is only sent on edit. A new customer starts Active by the
      // server's own default, and the create form has no toggle to send.
      return id === undefined
        ? createCustomer(payload)
        : updateCustomer(id, { ...payload, isActive: values.isActive })
    },
    onSuccess: (_customer, { id }) => {
      setRowError(null)
      void invalidateCustomers()
      // A new customer sorts to the top; land on it rather than on whatever page
      // the user happened to be reading.
      if (id === undefined) setPageIndex(0)
    },
    // No onError: the drawer awaits `mutateAsync`, catches the ApiError, and maps
    // it onto the field it belongs to (409 → email, 422 → named fields).
  })

  // [PROV-FR-CUST-02] Save — create and edit. Rejection is deliberate: it keeps
  // the drawer open with the user's input intact.
  const handleSave = (values: CustomerValues, id?: string) =>
    save.mutateAsync({ values, id })

  // [PROV-FR-CUST-04] Deactivate / Reactivate — status flip only.
  // TODO: PROV-FR-CUST-04 — deactivation does not touch the customer's open
  // orders. Whether it should is a business decision, not a wiring gap.
  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      updateCustomer(id, { isActive }),
    onSuccess: () => {
      setRowError(null)
      void invalidateCustomers()
    },
    onError: (err, { isActive }) => {
      const verb = isActive ? "reactivate" : "deactivate"
      if (isApiError(err) && err.isForbidden) {
        setRowError(`You do not have permission to ${verb} customers.`)
        return
      }
      setRowError(
        isApiError(err)
          ? err.message
          : `Could not ${verb} that customer — the server did not respond.`
      )
    },
  })

  // ---------------------------------------------------------------------------
  // Columns
  // ---------------------------------------------------------------------------
  const columns = React.useMemo<ColumnDef<Customer>[]>(
    () => [
      {
        id: "nameEmail",
        header: "Customer",
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium">{row.original.name}</span>
            <span className="text-xs text-muted-foreground">
              {row.original.email}
            </span>
          </div>
        ),
      },
      {
        accessorKey: "phone",
        header: "Phone",
        cell: ({ row }) =>
          row.original.phone || <span className="text-muted-foreground">—</span>,
      },
      {
        id: "createdAt",
        header: "Added",
        cell: ({ row }) =>
          new Date(row.original.createdAt).toLocaleDateString("en-US", {
            dateStyle: "medium",
          }),
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => (
          <StatusBadge
            status={row.original.isActive ? "Active" : "Inactive"}
            variantMap={CUSTOMER_STATUS_VARIANTS}
          />
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const customer = row.original
          const busy =
            toggleActive.isPending && toggleActive.variables?.id === customer.id

          return (
            <div className="flex items-center gap-1 justify-end">
              {/* View Details — always visible */}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleViewDetail(customer)}
              >
                <Eye className="h-4 w-4 mr-1" />
                View
              </Button>

              {/* customers.write actions */}
              {canManage && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleEditCustomer(customer)}
                  >
                    <Edit className="h-4 w-4 mr-1" />
                    Edit
                  </Button>

                  {customer.isActive ? (
                    <ConfirmDialog
                      trigger={
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          disabled={busy}
                        >
                          <UserX className="h-4 w-4 mr-1" />
                          Deactivate
                        </Button>
                      }
                      title="Deactivate customer?"
                      description={`${customer.name} will be marked Inactive. This does not affect existing orders.`}
                      confirmLabel="Deactivate"
                      variant="destructive"
                      onConfirm={() =>
                        toggleActive.mutate({
                          id: customer.id,
                          isActive: false,
                        })
                      }
                    />
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        toggleActive.mutate({ id: customer.id, isActive: true })
                      }
                    >
                      <UserCheck className="h-4 w-4 mr-1" />
                      Reactivate
                    </Button>
                  )}
                </>
              )}
            </div>
          )
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canManage, toggleActive.isPending, toggleActive.variables?.id]
  )

  return (
    <div className="flex flex-col gap-6">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <PageHeader
          title="Customers"
          description={
            total === undefined
              ? "Manage your customer records"
              : `${total} customer${total === 1 ? "" : "s"} on record`
          }
        />

        <div className="flex items-center gap-4">
          {canManage && (
            <Button onClick={handleAddCustomer}>
              <Plus className="mr-2 h-4 w-4" />
              Add Customer
            </Button>
          )}
        </div>
      </div>

      {/* ── Search ── */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Search by name or email…"
          aria-label="Search customers"
          className="pl-9"
        />
      </div>

      {rowError !== null && (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {rowError}
        </p>
      )}

      {/* ── Table ── */}
      <div className="bg-card border rounded-md p-4">
        {customersQuery.isError ? (
          <div className="space-y-3 py-8 text-center">
            <p role="alert" className="text-sm text-destructive">
              Could not load customers.
            </p>
            <Button
              variant="outline"
              onClick={() => void customersQuery.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={customers}
            isLoading={customersQuery.isPending}
            pageIndex={pageIndex}
            pageSize={PAGE_SIZE}
            pageCount={pageCount}
            onPageChange={setPageIndex}
          />
        )}
      </div>

      {/* ── Customer Drawer (Add / Edit) ── */}
      <CustomerDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        customer={editingCustomer}
        onSave={handleSave}
      />

      {/* ── Customer Detail Dialog ── */}
      <CustomerDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        customer={detailCustomer}
      />
    </div>
  )
}
