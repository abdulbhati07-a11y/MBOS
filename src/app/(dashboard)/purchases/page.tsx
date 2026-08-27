"use client"

// ---------------------------------------------------------------------------
// src/app/(dashboard)/purchases/page.tsx
//
// On the real API: `GET /suppliers` and `GET /purchase-orders`, both paginated
// server-side, both gated on the **purchases** module.
//
// Two behaviours changed with the move off mock data:
//
//   - "Deactivate" is `PATCH { isActive: false }`, not a delete. It keeps the row
//     visible and badged (what the confirm copy promises) and stays inside
//     `purchases.write`, so a Manager can do it. The DELETE endpoint exists but is
//     Owner-only (`purchases.delete`) and soft — not what this button means.
//   - A PO status move is `PATCH /:id/status { toStatus }`. The row still offers
//     only the transitions `PO_TRANSITIONS` allows, but the server is the
//     authority: an illegal move comes back 409 and surfaces as a banner rather
//     than silently flipping local state.
//
// Supplier search and the PO status filter are new UI — with the lists paginated,
// finding a row by scrolling past page one is no longer possible.
// ---------------------------------------------------------------------------

import * as React from "react"
import { ColumnDef } from "@tanstack/react-table"
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { Plus, Eye, Edit, UserX, UserCheck, ArrowRight, Lock, Search } from "lucide-react"

import { PageHeader } from "@/components/shared/PageHeader"
import { DataTable } from "@/components/shared/DataTable"
import { StatusBadge } from "@/components/shared/StatusBadge"
import { ConfirmDialog } from "@/components/shared/ConfirmDialog"
import { EmptyState } from "@/components/shared/EmptyState"
import { useBreadcrumb } from "@/contexts/breadcrumb-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useCanPerform } from "@/contexts/role-context"
import { Modules, Actions } from "@/config/permissions"

import { SupplierDrawer } from "@/components/purchases/SupplierDrawer"
import { PODetailDialog } from "@/components/purchases/PODetailDialog"
import { NewPOForm } from "@/components/purchases/NewPOForm"
import { formatMoneyMinor } from "@/lib/format/currency"

import {
  supplierKeys,
  fetchSuppliers,
  type Supplier,
  type SupplierListParams,
} from "@/lib/api/suppliers/queries"
import { createSupplier, updateSupplier } from "@/lib/api/suppliers/mutations"
import {
  purchaseOrderKeys,
  fetchPurchaseOrders,
  PO_TRANSITIONS,
  PO_STATUSES,
  type PurchaseOrder,
  type PurchaseOrderListParams,
  type POStatus,
} from "@/lib/api/purchases/queries"
import { updatePurchaseOrderStatus } from "@/lib/api/purchases/mutations"
import { isApiError } from "@/lib/api/client"
import { SupplierValues } from "@/lib/validation/purchases"

const PURCHASES_CRUMBS = [{ label: "Purchases" }] as const

const SUPPLIER_STATUS_VARIANTS: Record<string, "success" | "secondary"> = {
  Active: "success",
  Inactive: "secondary",
}

const PO_STATUS_VARIANTS: Record<POStatus, "secondary" | "warning" | "success" | "destructive"> = {
  Draft: "secondary",
  Sent: "warning",
  Received: "success",
  Cancelled: "destructive",
}

const TRANSITION_LABELS: Record<POStatus, string> = {
  Draft: "Draft",
  Sent: "Mark Sent",
  Received: "Mark Received",
  Cancelled: "Cancel PO",
}

const PAGE_SIZE = 10
const SEARCH_DEBOUNCE_MS = 300

/** Sentinel for the PO status filter's "all" option — Select needs a real value. */
const ALL_STATUSES = "all"

export default function PurchasesPage() {
  useBreadcrumb(
    "Purchases",
    PURCHASES_CRUMBS as unknown as { label: string; href?: string }[]
  )

  const queryClient = useQueryClient()

  // [PROV-PERM-04] Read gates the page; write gates every action on it.
  const canAccess = useCanPerform(Modules.PURCHASES, Actions.READ)
  const canWrite = useCanPerform(Modules.PURCHASES, Actions.WRITE)

  const [activeTab, setActiveTab] = React.useState("suppliers")

  // Row-level failures have nowhere else to go — no toast in this app — so they
  // surface as a banner above the active tab.
  const [rowError, setRowError] = React.useState<string | null>(null)

  // ── Supplier list state ──
  const [supplierPage, setSupplierPage] = React.useState(0)
  const [searchInput, setSearchInput] = React.useState("")
  const [search, setSearch] = React.useState("")

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim())
      setSupplierPage(0)
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [searchInput])

  const supplierParams = React.useMemo<SupplierListParams>(
    () => ({
      pageIndex: supplierPage,
      pageSize: PAGE_SIZE,
      ...(search === "" ? {} : { search }),
    }),
    [supplierPage, search]
  )

  const suppliersQuery = useQuery({
    queryKey: supplierKeys.list(supplierParams),
    queryFn: ({ signal }) => fetchSuppliers(supplierParams, signal),
    placeholderData: keepPreviousData,
  })

  const suppliers = suppliersQuery.data?.data ?? []
  const supplierPageCount = suppliersQuery.data?.pagination.pageCount ?? 0

  // ── PO list state ──
  const [poPage, setPoPage] = React.useState(0)
  const [statusFilter, setStatusFilter] = React.useState<POStatus | typeof ALL_STATUSES>(
    ALL_STATUSES
  )

  const poParams = React.useMemo<PurchaseOrderListParams>(
    () => ({
      pageIndex: poPage,
      pageSize: PAGE_SIZE,
      ...(statusFilter === ALL_STATUSES ? {} : { status: statusFilter }),
    }),
    [poPage, statusFilter]
  )

  const poQuery = useQuery({
    queryKey: purchaseOrderKeys.list(poParams),
    queryFn: ({ signal }) => fetchPurchaseOrders(poParams, signal),
    placeholderData: keepPreviousData,
  })

  const purchaseOrders = poQuery.data?.data ?? []
  const poPageCount = poQuery.data?.pagination.pageCount ?? 0

  // ── Drawer / dialog state ──
  const [drawerOpen, setDrawerOpen] = React.useState(false)
  const [editingSupplier, setEditingSupplier] = React.useState<Supplier | undefined>(
    undefined
  )
  const [detailOpen, setDetailOpen] = React.useState(false)
  const [detailPOId, setDetailPOId] = React.useState<string | null>(null)

  // ── Mutations ──
  const invalidateSuppliers = React.useCallback(
    () => queryClient.invalidateQueries({ queryKey: supplierKeys.all }),
    [queryClient]
  )

  const save = useMutation({
    mutationFn: ({ values, id }: { values: SupplierValues; id?: string }) => {
      // Pick DTO keys explicitly — a stray field trips `forbidNonWhitelisted`.
      const payload = {
        name: values.name,
        contactPerson: values.contactPerson,
        email: values.email,
        phone: values.phone,
        address: values.address,
        categories: values.categories,
        notes: values.notes,
      }
      // `isActive` only on edit — a new supplier starts Active by the server's
      // default, and the create form has no toggle to send.
      return id === undefined
        ? createSupplier(payload)
        : updateSupplier(id, { ...payload, isActive: values.isActive })
    },
    onSuccess: (_supplier, { id }) => {
      setRowError(null)
      void invalidateSuppliers()
      if (id === undefined) setSupplierPage(0)
    },
    // No onError: the drawer awaits mutateAsync and maps the ApiError onto fields.
  })

  const handleSaveSupplier = (values: SupplierValues, id?: string) =>
    save.mutateAsync({ values, id })

  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      updateSupplier(id, { isActive }),
    onSuccess: () => {
      setRowError(null)
      void invalidateSuppliers()
    },
    onError: (err, { isActive }) => {
      const verb = isActive ? "reactivate" : "deactivate"
      if (isApiError(err) && err.isForbidden) {
        setRowError(`You do not have permission to ${verb} suppliers.`)
        return
      }
      setRowError(
        isApiError(err)
          ? err.message
          : `Could not ${verb} that supplier — the server did not respond.`
      )
    },
  })

  const transition = useMutation({
    mutationFn: ({ id, toStatus }: { id: string; toStatus: POStatus }) =>
      updatePurchaseOrderStatus(id, toStatus),
    onSuccess: () => {
      setRowError(null)
      void queryClient.invalidateQueries({ queryKey: purchaseOrderKeys.all })
    },
    onError: (err) => {
      if (isApiError(err) && err.isConflict) {
        setRowError(
          "That status change is no longer allowed — the order may have already moved on. Refresh and try again."
        )
        return
      }
      if (isApiError(err) && err.isForbidden) {
        setRowError("You do not have permission to change purchase-order status.")
        return
      }
      setRowError(
        isApiError(err)
          ? err.message
          : "Could not update the purchase order — the server did not respond."
      )
    },
  })

  // ── Handlers ──
  const handleAddSupplier = () => {
    setEditingSupplier(undefined)
    setDrawerOpen(true)
  }

  const handleEditSupplier = (supplier: Supplier) => {
    setEditingSupplier(supplier)
    setDrawerOpen(true)
  }

  const handleViewPO = (po: PurchaseOrder) => {
    setDetailPOId(po.id)
    setDetailOpen(true)
  }

  // ---------------------------------------------------------------------------
  // Supplier columns
  // ---------------------------------------------------------------------------
  const supplierColumns = React.useMemo<ColumnDef<Supplier>[]>(
    () => [
      {
        id: "nameContact",
        header: "Supplier",
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium">{row.original.name}</span>
            <span className="text-xs text-muted-foreground">
              {row.original.contactPerson}
            </span>
          </div>
        ),
      },
      {
        accessorKey: "email",
        header: "Email",
      },
      {
        accessorKey: "phone",
        header: "Phone",
        cell: ({ row }) =>
          row.original.phone || <span className="text-muted-foreground">—</span>,
      },
      {
        accessorKey: "categories",
        header: "Categories",
        cell: ({ row }) =>
          row.original.categories || <span className="text-muted-foreground">—</span>,
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => (
          <StatusBadge
            status={row.original.isActive ? "Active" : "Inactive"}
            variantMap={SUPPLIER_STATUS_VARIANTS}
          />
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const supplier = row.original
          if (!canWrite) return null
          const busy =
            toggleActive.isPending && toggleActive.variables?.id === supplier.id
          return (
            <div className="flex items-center gap-1 justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleEditSupplier(supplier)}
              >
                <Edit className="h-4 w-4 mr-1" />
                Edit
              </Button>
              {supplier.isActive ? (
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
                  title="Deactivate supplier?"
                  description={`${supplier.name} will be marked Inactive.`}
                  confirmLabel="Deactivate"
                  variant="destructive"
                  onConfirm={() => toggleActive.mutate({ id: supplier.id, isActive: false })}
                />
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => toggleActive.mutate({ id: supplier.id, isActive: true })}
                >
                  <UserCheck className="h-4 w-4 mr-1" />
                  Reactivate
                </Button>
              )}
            </div>
          )
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canWrite, toggleActive.isPending, toggleActive.variables?.id]
  )

  // ---------------------------------------------------------------------------
  // PO columns
  // ---------------------------------------------------------------------------
  const poColumns = React.useMemo<ColumnDef<PurchaseOrder>[]>(
    () => [
      {
        accessorKey: "poNumber",
        header: "PO Number",
        cell: ({ row }) => (
          <span className="font-medium font-mono">{row.original.poNumber}</span>
        ),
      },
      {
        accessorKey: "date",
        header: "Date",
        cell: ({ row }) =>
          new Date(row.original.date).toLocaleDateString("en-US", {
            dateStyle: "medium",
          }),
      },
      {
        accessorKey: "supplierName",
        header: "Supplier",
      },
      {
        id: "itemCount",
        header: "Items",
        cell: ({ row }) => row.original.lineCount,
      },
      {
        id: "total",
        header: "Total",
        cell: ({ row }) => (
          <span className="font-medium">{formatMoneyMinor(row.original.totalCents)}</span>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <StatusBadge status={row.original.status} variantMap={PO_STATUS_VARIANTS} />
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const po = row.original
          // Available moves come from the state machine — no hardcoded conditionals.
          const nextStatuses = PO_TRANSITIONS[po.status]
          const busy = transition.isPending && transition.variables?.id === po.id
          return (
            <div className="flex items-center gap-1 justify-end flex-wrap">
              <Button variant="ghost" size="sm" onClick={() => handleViewPO(po)}>
                <Eye className="h-4 w-4 mr-1" />
                View
              </Button>
              {!canWrite || nextStatuses.length === 0 ? (
                nextStatuses.length === 0 ? (
                  <span className="text-xs text-muted-foreground italic px-1">
                    {po.status === "Received" ? "Fulfilled" : "Closed"}
                  </span>
                ) : null
              ) : (
                nextStatuses.map((next) => (
                  <Button
                    key={next}
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    className={
                      next === "Cancelled"
                        ? "text-destructive border-destructive/40 hover:bg-destructive/10"
                        : ""
                    }
                    onClick={() => transition.mutate({ id: po.id, toStatus: next })}
                  >
                    <ArrowRight className="h-3.5 w-3.5 mr-1" />
                    {TRANSITION_LABELS[next]}
                  </Button>
                ))
              )}
            </div>
          )
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canWrite, transition.isPending, transition.variables?.id]
  )

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="flex flex-col gap-6">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <PageHeader title="Purchases" description="Manage suppliers and purchase orders" />

        <div className="flex items-center gap-4">
          {canWrite && activeTab === "suppliers" && (
            <Button onClick={handleAddSupplier}>
              <Plus className="mr-2 h-4 w-4" />
              Add Supplier
            </Button>
          )}
          {canWrite && activeTab === "purchase-orders" && (
            <Button onClick={() => setActiveTab("new-po")}>
              <Plus className="mr-2 h-4 w-4" />
              New PO
            </Button>
          )}
        </div>
      </div>

      {/* [PROV-PERM-04] Read-denied guard */}
      {!canAccess ? (
        <EmptyState
          icon={Lock}
          title="Access restricted"
          description="You don't have access to the Purchases module. Contact your manager."
          className="mt-4"
        />
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="suppliers">Suppliers</TabsTrigger>
            <TabsTrigger value="purchase-orders">Purchase Orders</TabsTrigger>
            {canWrite && <TabsTrigger value="new-po">New PO</TabsTrigger>}
          </TabsList>

          {rowError !== null && (
            <p
              role="alert"
              className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {rowError}
            </p>
          )}

          {/* ── Suppliers tab ── */}
          <TabsContent value="suppliers" className="space-y-4">
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Search by name or email…"
                aria-label="Search suppliers"
                className="pl-9"
              />
            </div>
            <div className="bg-card border rounded-md p-4">
              {suppliersQuery.isError ? (
                <div className="space-y-3 py-8 text-center">
                  <p role="alert" className="text-sm text-destructive">
                    Could not load suppliers.
                  </p>
                  <Button variant="outline" onClick={() => void suppliersQuery.refetch()}>
                    Try again
                  </Button>
                </div>
              ) : (
                <DataTable
                  columns={supplierColumns}
                  data={suppliers}
                  isLoading={suppliersQuery.isPending}
                  pageIndex={supplierPage}
                  pageSize={PAGE_SIZE}
                  pageCount={supplierPageCount}
                  onPageChange={setSupplierPage}
                />
              )}
            </div>
          </TabsContent>

          {/* ── Purchase Orders tab ── */}
          <TabsContent value="purchase-orders" className="space-y-4">
            <div className="max-w-[12rem]">
              <Select
                value={statusFilter}
                onValueChange={(v) => {
                  setStatusFilter(v as POStatus | typeof ALL_STATUSES)
                  setPoPage(0)
                }}
              >
                <SelectTrigger className="w-full" aria-label="Filter by status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_STATUSES}>All statuses</SelectItem>
                  {PO_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="bg-card border rounded-md p-4">
              {poQuery.isError ? (
                <div className="space-y-3 py-8 text-center">
                  <p role="alert" className="text-sm text-destructive">
                    Could not load purchase orders.
                  </p>
                  <Button variant="outline" onClick={() => void poQuery.refetch()}>
                    Try again
                  </Button>
                </div>
              ) : (
                <DataTable
                  columns={poColumns}
                  data={purchaseOrders}
                  isLoading={poQuery.isPending}
                  pageIndex={poPage}
                  pageSize={PAGE_SIZE}
                  pageCount={poPageCount}
                  onPageChange={setPoPage}
                />
              )}
            </div>
          </TabsContent>

          {/* ── New PO tab ── */}
          {canWrite && (
            <TabsContent value="new-po">
              <NewPOForm
                onCreated={() => {
                  setPoPage(0)
                  setStatusFilter(ALL_STATUSES)
                  setActiveTab("purchase-orders")
                }}
              />
            </TabsContent>
          )}
        </Tabs>
      )}

      {/* ── Supplier Drawer ── */}
      <SupplierDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        supplier={editingSupplier}
        onSave={handleSaveSupplier}
      />

      {/* ── PO Detail Dialog ── */}
      <PODetailDialog open={detailOpen} onOpenChange={setDetailOpen} poId={detailPOId} />
    </div>
  )
}
