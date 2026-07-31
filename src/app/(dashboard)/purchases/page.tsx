"use client"

import * as React from "react"
import { ColumnDef } from "@tanstack/react-table"
import { Plus, Eye, Edit, UserX, UserCheck, ArrowRight, Lock } from "lucide-react"

import { PageHeader } from "@/components/shared/PageHeader"
import { DataTable } from "@/components/shared/DataTable"
import { StatusBadge } from "@/components/shared/StatusBadge"
import { ConfirmDialog } from "@/components/shared/ConfirmDialog"
import { EmptyState } from "@/components/shared/EmptyState"
import { useBreadcrumb } from "@/contexts/breadcrumb-context"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { useCanPerform } from "@/contexts/role-context"
import { Modules, Actions } from "@/config/permissions"

import { SupplierDrawer } from "@/components/purchases/SupplierDrawer"
import { PODetailDialog } from "@/components/purchases/PODetailDialog"
import { NewPOForm } from "@/components/purchases/NewPOForm"

import {
  MOCK_SUPPLIERS,
  SupplierRecord,
} from "@/lib/mock-data/suppliers"
import {
  MOCK_PURCHASE_ORDERS,
  PurchaseOrderRecord,
  POStatus,
  PO_TRANSITIONS,
} from "@/lib/mock-data/purchase-orders"
import { SupplierValues } from "@/lib/validation/purchases"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const PURCHASES_CRUMBS = [{ label: "Purchases" }] as const

const SUPPLIER_STATUS_VARIANTS: Record<string, "success" | "secondary"> = {
  Active: "success",
  Inactive: "secondary",
}

const PO_STATUS_VARIANTS: Record<POStatus, "secondary" | "warning" | "success" | "destructive"> = {
  Draft:     "secondary",
  Sent:      "warning",
  Received:  "success",
  Cancelled: "destructive",
}

// Human-readable labels for transition target buttons
const TRANSITION_LABELS: Record<POStatus, string> = {
  Draft:     "Draft",
  Sent:      "Mark Sent",
  Received:  "Mark Received",
  Cancelled: "Cancel PO",
}

const PAGE_SIZE = 10

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function PurchasesPage() {
  useBreadcrumb(
    "Purchases",
    PURCHASES_CRUMBS as unknown as { label: string; href?: string }[]
  )

  // [PROV-PERM-04] Permission via RoleContext
  const canAccess = useCanPerform(Modules.PURCHASES, Actions.READ)

  const [activeTab, setActiveTab] = React.useState("suppliers")

  // ── Supplier state ──
  const [suppliers, setSuppliers] = React.useState<SupplierRecord[]>(MOCK_SUPPLIERS)
  const [supplierPage, setSupplierPage] = React.useState(0)
  const [drawerOpen, setDrawerOpen] = React.useState(false)
  const [editingSupplier, setEditingSupplier] = React.useState<SupplierRecord | undefined>(undefined)

  // ── PO state ──
  const [purchaseOrders, setPurchaseOrders] = React.useState<PurchaseOrderRecord[]>(MOCK_PURCHASE_ORDERS)
  const [poPage, setPoPage] = React.useState(0)
  const [detailOpen, setDetailOpen] = React.useState(false)
  const [detailPO, setDetailPO] = React.useState<PurchaseOrderRecord | null>(null)

  // ── Supplier handlers ──
  const handleAddSupplier = () => {
    setEditingSupplier(undefined)
    setDrawerOpen(true)
  }

  const handleEditSupplier = (supplier: SupplierRecord) => {
    setEditingSupplier(supplier)
    setDrawerOpen(true)
  }

  const handleSaveSupplier = (values: SupplierValues, id?: string) => {
    if (id) {
      setSuppliers((prev) =>
        prev.map((s) =>
          s.id === id
            ? {
                ...s,
                name: values.name,
                contactPerson: values.contactPerson,
                email: values.email,
                phone: values.phone ?? "",
                address: values.address ?? "",
                categories: values.categories ?? "",
                notes: values.notes ?? "",
                isActive: values.isActive,
              }
            : s
        )
      )
    } else {
      const newSupplier: SupplierRecord = {
        id: `sup-${Date.now()}`,
        name: values.name,
        contactPerson: values.contactPerson,
        email: values.email,
        phone: values.phone ?? "",
        address: values.address ?? "",
        categories: values.categories ?? "",
        notes: values.notes ?? "",
        isActive: true,
      }
      setSuppliers((prev) => [newSupplier, ...prev])
      setSupplierPage(0)
    }
  }

  // [PROV-FR-PUR-02] Deactivate / Reactivate — status flip only
  const handleToggleSupplier = (id: string, activate: boolean) => {
    setSuppliers((prev) =>
      prev.map((s) => (s.id === id ? { ...s, isActive: activate } : s))
    )
  }

  // ── PO handlers ──
  const handleViewPO = (po: PurchaseOrderRecord) => {
    setDetailPO(po)
    setDetailOpen(true)
  }

  // [PROV-FR-PUR-05] Status transition — only allows moves defined in PO_TRANSITIONS.
  // TODO: PROV-FR-PUR-05 — Received transition should trigger stock increment when backend exists.
  const handleTransition = (id: string, nextStatus: POStatus) => {
    setPurchaseOrders((prev) =>
      prev.map((po) => (po.id === id ? { ...po, status: nextStatus } : po))
    )
  }

  const handlePOCreated = (po: PurchaseOrderRecord) => {
    setPurchaseOrders((prev) => [po, ...prev])
    setPoPage(0)
    setActiveTab("purchase-orders")
  }

  // ── Pagination ──
  const supplierPageCount = Math.ceil(suppliers.length / PAGE_SIZE)
  const pagedSuppliers = suppliers.slice(
    supplierPage * PAGE_SIZE,
    (supplierPage + 1) * PAGE_SIZE
  )

  const poPageCount = Math.ceil(purchaseOrders.length / PAGE_SIZE)
  const pagedPOs = purchaseOrders.slice(
    poPage * PAGE_SIZE,
    (poPage + 1) * PAGE_SIZE
  )

  // ---------------------------------------------------------------------------
  // Supplier columns
  // ---------------------------------------------------------------------------
  const supplierColumns = React.useMemo<ColumnDef<SupplierRecord>[]>(
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
                    >
                      <UserX className="h-4 w-4 mr-1" />
                      Deactivate
                    </Button>
                  }
                  title="Deactivate supplier?"
                  description={`${supplier.name} will be marked Inactive.`}
                  confirmLabel="Deactivate"
                  variant="destructive"
                  onConfirm={() => handleToggleSupplier(supplier.id, false)}
                />
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleToggleSupplier(supplier.id, true)}
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
    []
  )

  // ---------------------------------------------------------------------------
  // PO columns
  // ---------------------------------------------------------------------------
  const poColumns = React.useMemo<ColumnDef<PurchaseOrderRecord>[]>(
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
        cell: ({ row }) => row.original.lines.length,
      },
      {
        accessorKey: "total",
        header: "Total",
        cell: ({ row }) => (
          <span className="font-medium">${row.original.total.toFixed(2)}</span>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <StatusBadge
            status={row.original.status}
            variantMap={PO_STATUS_VARIANTS}
          />
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const po = row.original
          // Available transitions come from PO_TRANSITIONS — the state machine
          // is the single source of truth; no hardcoded conditionals here.
          const nextStatuses = PO_TRANSITIONS[po.status]
          return (
            <div className="flex items-center gap-1 justify-end flex-wrap">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleViewPO(po)}
              >
                <Eye className="h-4 w-4 mr-1" />
                View
              </Button>
              {nextStatuses.length === 0 ? (
                // Terminal state — no further transitions available.
                // Rendered explicitly so the column doesn't appear incomplete.
                <span className="text-xs text-muted-foreground italic px-1">
                  {po.status === "Received" ? "Fulfilled" : "Closed"}
                </span>
              ) : (
                nextStatuses.map((next) => (
                  <Button
                    key={next}
                    variant="outline"
                    size="sm"
                    className={
                      next === "Cancelled"
                        ? "text-destructive border-destructive/40 hover:bg-destructive/10"
                        : ""
                    }
                    onClick={() => handleTransition(po.id, next)}
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
    []
  )

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="flex flex-col gap-6">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <PageHeader
          title="Purchases"
          description="Manage suppliers and purchase orders"
        />

        <div className="flex items-center gap-4">
          {canAccess && activeTab === "suppliers" && (
            <Button onClick={handleAddSupplier}>
              <Plus className="mr-2 h-4 w-4" />
              Add Supplier
            </Button>
          )}
          {canAccess && activeTab === "purchase-orders" && (
            <Button onClick={() => setActiveTab("new-po")}>
              <Plus className="mr-2 h-4 w-4" />
              New PO
            </Button>
          )}
        </div>
      </div>

      {/* [PROV-PERM-04] Cashier access-denied guard */}
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
            <TabsTrigger value="new-po">New PO</TabsTrigger>
          </TabsList>

          {/* ── Suppliers tab ── */}
          <TabsContent value="suppliers">
            <div className="bg-card border rounded-md p-4">
              <DataTable
                columns={supplierColumns}
                data={pagedSuppliers}
                pageIndex={supplierPage}
                pageSize={PAGE_SIZE}
                pageCount={supplierPageCount}
                onPageChange={setSupplierPage}
              />
            </div>
          </TabsContent>

          {/* ── Purchase Orders tab ── */}
          <TabsContent value="purchase-orders">
            <div className="bg-card border rounded-md p-4">
              <DataTable
                columns={poColumns}
                data={pagedPOs}
                pageIndex={poPage}
                pageSize={PAGE_SIZE}
                pageCount={poPageCount}
                onPageChange={setPoPage}
              />
            </div>
          </TabsContent>

          {/* ── New PO tab ── */}
          <TabsContent value="new-po">
            <NewPOForm onPOCreated={handlePOCreated} />
          </TabsContent>
        </Tabs>
      )}

      {/* ── Supplier Drawer ── */}
      <SupplierDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        supplier={editingSupplier}
        suppliers={suppliers}
        onSave={handleSaveSupplier}
      />

      {/* ── PO Detail Dialog ── */}
      <PODetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        po={detailPO}
      />
    </div>
  )
}
