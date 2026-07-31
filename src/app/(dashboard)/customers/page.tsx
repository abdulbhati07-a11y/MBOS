"use client"

import * as React from "react"
import { ColumnDef } from "@tanstack/react-table"
import { Plus, Edit, UserX, UserCheck, Eye } from "lucide-react"

import { PageHeader } from "@/components/shared/PageHeader"
import { DataTable } from "@/components/shared/DataTable"
import { StatusBadge } from "@/components/shared/StatusBadge"
import { ConfirmDialog } from "@/components/shared/ConfirmDialog"
import { useBreadcrumb } from "@/contexts/breadcrumb-context"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"

import { CustomerDrawer } from "@/components/customers/CustomerDrawer"
import { CustomerDetailDialog } from "@/components/customers/CustomerDetailDialog"
import {
  MOCK_CUSTOMERS,
  CustomerRecord,
  getCustomerStats,
} from "@/lib/mock-data/customers"
import { CustomerValues } from "@/lib/validation/customers"

// TODO: NewOrderForm.customerName is free-text and unlinked to CustomerRecord;
// linking is deferred to backend integration phase.

const CUSTOMERS_CRUMBS = [{ label: "Customers" }] as const

const CUSTOMER_STATUS_VARIANTS: Record<string, "success" | "secondary"> = {
  Active: "success",
  Inactive: "secondary",
}

const PAGE_SIZE = 10

export default function CustomersPage() {
  useBreadcrumb(
    "Customers",
    CUSTOMERS_CRUMBS as unknown as { label: string; href?: string }[]
  )

  // [PROV-PERM-03] Persona Mocking Toggle
  // TODO: remove once real auth/permissions context exists
  const [role, setRole] = React.useState<"Manager" | "Cashier">("Manager")
  const canManage = role === "Manager"

  // Customer list state — starts from seed data, mutations are in-memory only
  const [customers, setCustomers] = React.useState<CustomerRecord[]>(MOCK_CUSTOMERS)
  const [pageIndex, setPageIndex] = React.useState(0)

  // Drawer state
  const [drawerOpen, setDrawerOpen] = React.useState(false)
  const [editingCustomer, setEditingCustomer] = React.useState<
    CustomerRecord | undefined
  >(undefined)

  // Detail dialog state
  const [detailOpen, setDetailOpen] = React.useState(false)
  const [detailCustomer, setDetailCustomer] = React.useState<CustomerRecord | null>(null)

  const handleAddCustomer = () => {
    setEditingCustomer(undefined)
    setDrawerOpen(true)
  }

  const handleEditCustomer = (customer: CustomerRecord) => {
    setEditingCustomer(customer)
    setDrawerOpen(true)
  }

  const handleViewDetail = (customer: CustomerRecord) => {
    setDetailCustomer(customer)
    setDetailOpen(true)
  }

  // [PROV-FR-CUST-02] Save — handles both create and edit
  const handleSave = (values: CustomerValues, id?: string) => {
    if (id) {
      // Edit
      setCustomers((prev) =>
        prev.map((c) =>
          c.id === id
            ? {
                ...c,
                name: values.name,
                email: values.email,
                phone: values.phone ?? "",
                address: values.address ?? "",
                notes: values.notes ?? "",
                isActive: values.isActive,
              }
            : c
        )
      )
    } else {
      // Create — new customers always start Active
      const newCustomer: CustomerRecord = {
        id: `cust-${Date.now()}`,
        name: values.name,
        email: values.email,
        phone: values.phone ?? "",
        address: values.address ?? "",
        notes: values.notes ?? "",
        isActive: true,
      }
      setCustomers((prev) => [newCustomer, ...prev])
      setPageIndex(0)
    }
  }

  // [PROV-FR-CUST-04] Deactivate / Reactivate — status flip only
  // TODO: PROV-FR-CUST-04 — deactivation should cascade to open orders when backend exists
  const handleToggleActive = (id: string, activate: boolean) => {
    setCustomers((prev) =>
      prev.map((c) => (c.id === id ? { ...c, isActive: activate } : c))
    )
  }

  // Pagination
  const pageCount = Math.ceil(customers.length / PAGE_SIZE)
  const pagedCustomers = customers.slice(
    pageIndex * PAGE_SIZE,
    (pageIndex + 1) * PAGE_SIZE
  )

  // ---------------------------------------------------------------------------
  // Columns
  // ---------------------------------------------------------------------------
  const columns = React.useMemo<ColumnDef<CustomerRecord>[]>(
    () => {
      const cols: ColumnDef<CustomerRecord>[] = [
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
            row.original.phone || (
              <span className="text-muted-foreground">—</span>
            ),
        },
        {
          id: "totalOrders",
          header: "Orders",
          cell: ({ row }) => {
            const { totalOrders } = getCustomerStats(row.original.name)
            return totalOrders
          },
        },
        {
          id: "totalSpend",
          header: "Total Spend",
          cell: ({ row }) => {
            const { totalSpend } = getCustomerStats(row.original.name)
            return `$${totalSpend.toFixed(2)}`
          },
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

                {/* Manager-only actions */}
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
                          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                            <UserX className="h-4 w-4 mr-1" />
                            Deactivate
                          </Button>
                        }
                        title="Deactivate customer?"
                        description={`${customer.name} will be marked Inactive. This does not affect existing orders.`}
                        confirmLabel="Deactivate"
                        variant="destructive"
                        onConfirm={() => handleToggleActive(customer.id, false)}
                      />
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggleActive(customer.id, true)}
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
      ]
      return cols
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canManage]
  )

  return (
    <div className="flex flex-col gap-6">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <PageHeader
          title="Customers"
          description="Manage your customer records"
        />

        <div className="flex items-center gap-4">
          {/* TODO: remove once real auth/permissions context exists */}
          <div className="flex items-center gap-2 bg-muted p-2 rounded-md">
            <span className="text-xs text-muted-foreground">Cashier</span>
            <Switch
              checked={role === "Manager"}
              onCheckedChange={(checked) =>
                setRole(checked ? "Manager" : "Cashier")
              }
            />
            <span className="text-xs text-muted-foreground">Manager</span>
          </div>

          {canManage && (
            <Button onClick={handleAddCustomer}>
              <Plus className="mr-2 h-4 w-4" />
              Add Customer
            </Button>
          )}
        </div>
      </div>

      {/* ── Table ── */}
      <div className="bg-card border rounded-md p-4">
        <DataTable
          columns={columns}
          data={pagedCustomers}
          pageIndex={pageIndex}
          pageSize={PAGE_SIZE}
          pageCount={pageCount}
          onPageChange={setPageIndex}
        />
      </div>

      {/* ── Customer Drawer (Add / Edit) ── */}
      <CustomerDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        customer={editingCustomer}
        customers={customers}
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
