"use client"

import * as React from "react"
import { ColumnDef } from "@tanstack/react-table"
import { Plus, MoreHorizontal, Edit, BarChart2 } from "lucide-react"

import { PageHeader } from "@/components/shared/PageHeader"
import { DataTable } from "@/components/shared/DataTable"
import { StatusBadge } from "@/components/shared/StatusBadge"
import { useBreadcrumb } from "@/contexts/breadcrumb-context"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ProductDrawer } from "@/components/inventory/ProductDrawer"
import { StockAdjustmentDialog } from "@/components/inventory/StockAdjustmentDialog"
import { ProductValues } from "@/lib/validation/inventory"
import { StockAdjustmentValues } from "@/lib/validation/inventory"
import { useCanPerform } from "@/contexts/role-context"
import { Modules, Actions } from "@/config/permissions"
import { useProducts, useSetProducts } from "@/contexts/products-context"
import { type ProductRecord } from "@/lib/mock-data/products"

const INVENTORY_CRUMBS = [{ label: "Inventory" }] as const

export default function InventoryPage() {
  useBreadcrumb("Inventory", INVENTORY_CRUMBS as unknown as { label: string; href?: string }[])

  const canWrite = useCanPerform(Modules.INVENTORY, Actions.WRITE)

  // Live product state from shared context — Inventory writes, Sales reads
  const products = useProducts()
  const setProducts = useSetProducts()

  // Drawer state
  const [drawerOpen, setDrawerOpen] = React.useState(false)
  const [editingProduct, setEditingProduct] = React.useState<
    { values: ProductValues; id: string } | undefined
  >(undefined)

  // Stock adjustment dialog state
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [adjustingProduct, setAdjustingProduct] = React.useState<{
    id: string
    name: string
    stock: number
  } | null>(null)

  const handleCreateProduct = () => {
    setEditingProduct(undefined)
    setDrawerOpen(true)
  }

  const handleEditProduct = (product: ProductRecord) => {
    setEditingProduct({
      id: product.id,
      values: {
        name: product.name,
        sku: product.sku,
        category: product.category,
        price: product.price,
        cost: product.cost,
        uom: product.uom,
        reorderPoint: product.reorderPoint,
        initialStock: 0, // not used in edit mode
      },
    })
    setDrawerOpen(true)
  }

  const handleAdjustStock = (product: ProductRecord) => {
    setAdjustingProduct({ id: product.id, name: product.name, stock: product.stock })
    setDialogOpen(true)
  }

  // ---------------------------------------------------------------------------
  // Save product — add or update in shared context
  // ---------------------------------------------------------------------------
  const handleSaveProduct = (data: ProductValues, id?: string) => {
    if (id) {
      // Edit existing
      setProducts((prev) =>
        prev.map((p) =>
          p.id === id
            ? {
                ...p,
                name: data.name,
                sku: data.sku,
                category: data.category,
                price: data.price,
                cost: data.cost,
                uom: data.uom,
                reorderPoint: data.reorderPoint,
              }
            : p
        )
      )
    } else {
      // Create new
      const newProduct: ProductRecord = {
        id: `prod-${Date.now()}`,
        name: data.name,
        sku: data.sku,
        category: data.category,
        price: data.price,
        cost: data.cost,
        uom: data.uom,
        reorderPoint: data.reorderPoint,
        stock: data.initialStock ?? 0,
      }
      setProducts((prev) => [newProduct, ...prev])
    }
  }

  // ---------------------------------------------------------------------------
  // Confirm stock adjustment — mutates stock in shared context
  // PROV-BR-07: negative stock guard is enforced in StockAdjustmentDialog
  // ---------------------------------------------------------------------------
  const handleConfirmAdjustment = (data: StockAdjustmentValues) => {
    if (!adjustingProduct) return
    setProducts((prev) =>
      prev.map((p) => {
        if (p.id !== adjustingProduct.id) return p
        let newStock = p.stock
        if (data.type === "ADD")    newStock = p.stock + data.quantity
        if (data.type === "REMOVE") newStock = p.stock - data.quantity
        if (data.type === "COUNT")  newStock = data.quantity
        return { ...p, stock: Math.max(0, newStock) }
      })
    )
  }

  // ---------------------------------------------------------------------------
  // Columns
  // ---------------------------------------------------------------------------
  const columns = React.useMemo<ColumnDef<ProductRecord>[]>(() => {
    const cols: ColumnDef<ProductRecord>[] = [
      {
        accessorKey: "name",
        header: "Product",
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium">{row.original.name}</span>
            <span className="text-xs text-muted-foreground">{row.original.sku}</span>
          </div>
        ),
      },
      {
        accessorKey: "category",
        header: "Category",
      },
      {
        accessorKey: "price",
        header: "Price",
        cell: ({ row }) => `$${row.original.price.toFixed(2)}`,
      },
      {
        accessorKey: "stock",
        header: "Stock Level",
        cell: ({ row }) => {
          const stock = row.original.stock
          const rp = row.original.reorderPoint
          let statusText = ""
          let variantMap: Record<string, "success" | "warning" | "destructive"> = {}
          let statusKey = ""

          if (stock === 0) {
            statusText = "Out of Stock"
            statusKey = "out"
            variantMap = { out: "destructive" }
          } else if (stock <= rp) {
            statusText = "Low Stock"
            statusKey = "low"
            variantMap = { low: "warning" }
          } else {
            statusText = "In Stock"
            statusKey = "in"
            variantMap = { in: "success" }
          }

          return (
            <div className="flex items-center gap-2">
              <span>{stock} {row.original.uom}</span>
              <StatusBadge
                status={statusKey}
                variantMap={variantMap}
                className="hidden sm:inline-flex"
              >
                {statusText}
              </StatusBadge>
            </div>
          )
        },
      },
    ]

    if (canWrite) {
      cols.push({
        id: "actions",
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" className="h-8 w-8 p-0" />}>
              <span className="sr-only">Open menu</span>
              <MoreHorizontal className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => handleAdjustStock(row.original)}>
                <BarChart2 className="mr-2 h-4 w-4" />
                Adjust Stock
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleEditProduct(row.original)}>
                <Edit className="mr-2 h-4 w-4" />
                Edit Product
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      })
    }

    return cols
  }, [canWrite])

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <PageHeader
          title="Inventory"
          description="Manage your product catalog and stock levels"
        />
        <div className="flex items-center gap-4">
          {canWrite && (
            <Button onClick={handleCreateProduct}>
              <Plus className="mr-2 h-4 w-4" />
              Add Product
            </Button>
          )}
        </div>
      </div>

      <div className="bg-card border rounded-md p-4">
        <DataTable
          columns={columns}
          data={products}
          pageCount={1}
          pageIndex={0}
          pageSize={10}
        />
      </div>

      <ProductDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        product={editingProduct?.values}
        onSave={(data) => handleSaveProduct(data, editingProduct?.id)}
      />

      <StockAdjustmentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        productName={adjustingProduct?.name ?? ""}
        currentStock={adjustingProduct?.stock ?? 0}
        onConfirm={handleConfirmAdjustment}
      />
    </div>
  )
}
