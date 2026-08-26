"use client"

import * as React from "react"
import { PageHeader } from "@/components/shared/PageHeader"
import { DataTable } from "@/components/shared/DataTable"
import { StatusBadge, type StatusVariant } from "@/components/shared/StatusBadge"
import { ConfirmDialog } from "@/components/shared/ConfirmDialog"
import { Button } from "@/components/ui/button"
import { Trash2, PackagePlus } from "lucide-react"
import { type ColumnDef } from "@tanstack/react-table"
import { formatMoney } from "@/lib/format/currency"

// Mock Data Type
type MockItem = {
  id: string
  name: string
  sku: string
  status: string
  price: number
}

// Mock Data — prices are rupees (major units), like every other price in the app.
const mockData: MockItem[] = [
  { id: "1", name: "Wireless Keyboard", sku: "KB-001", status: "active", price: 4599 },
  { id: "2", name: "Gaming Mouse", sku: "MS-002", status: "low_stock", price: 2999 },
  { id: "3", name: "27in Monitor", sku: "MN-003", status: "out_of_stock", price: 19999 },
  { id: "4", name: "USB-C Hub", sku: "HB-004", status: "active", price: 3450 },
]

// Status Variant Map for StatusBadge
const itemStatusMap: Record<string, StatusVariant> = {
  active: "success",
  low_stock: "warning",
  out_of_stock: "destructive",
}

export default function TestPage() {
  const [isLoading, setIsLoading] = React.useState(false)
  const [isEmpty, setIsEmpty] = React.useState(false)
  const [pageIndex, setPageIndex] = React.useState(0)

  // Columns Definition
  const columns: ColumnDef<MockItem>[] = [
    {
      accessorKey: "name",
      header: "Product Name",
    },
    {
      accessorKey: "sku",
      header: "SKU",
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => {
        const status = row.getValue("status") as string
        return (
          <StatusBadge 
            status={status} 
            variantMap={itemStatusMap} 
          />
        )
      },
    },
    {
      accessorKey: "price",
      header: "Price",
      cell: ({ row }) => {
        const amount = parseFloat(row.getValue("price"))
        return <div className="font-medium">{formatMoney(amount)}</div>
      },
    },
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }) => {
        const item = row.original
        return (
          <ConfirmDialog
            trigger={
              <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive hover:bg-destructive/10">
                <Trash2 className="h-4 w-4" />
                <span className="sr-only">Delete</span>
              </Button>
            }
            title="Delete Product"
            description={`Are you sure you want to delete ${item.name}? This action cannot be undone.`}
            confirmLabel="Delete"
            variant="destructive"
            onConfirm={() => console.log(`Deleted ${item.id}`)}
          />
        )
      },
    },
  ]

  const currentData = isEmpty ? [] : mockData

  return (
    <div className="space-y-6">
      <PageHeader
        title="Component Test Page"
        description="Verifying all 5 core shared components in a single view."
        actions={
          <>
            <Button variant="outline" onClick={() => setIsLoading(!isLoading)}>
              Toggle Loading
            </Button>
            <Button variant="outline" onClick={() => setIsEmpty(!isEmpty)}>
              Toggle Empty Data
            </Button>
            <Button>
              <PackagePlus className="h-4 w-4 mr-2" />
              Add Product
            </Button>
          </>
        }
      />

      <DataTable
        columns={columns}
        data={currentData}
        isLoading={isLoading}
        pageIndex={pageIndex}
        pageSize={4}
        pageCount={5} // Mocking pageCount to verify pagination footer
        onPageChange={(newPageIndex) => setPageIndex(newPageIndex)}
      />
    </div>
  )
}
