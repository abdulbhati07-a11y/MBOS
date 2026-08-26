"use client"

// ---------------------------------------------------------------------------
// src/app/(dashboard)/inventory/page.tsx
//
// On the real API: `GET /products` paginated, with a search box and a low-stock
// filter that are both server-side.
//
// The three conversions this page owns, because they are the seam between a form
// that speaks in rupees and units and an API that speaks in paisa and deltas:
//
//   1. `price`/`cost` (rupees, as typed) → `priceCents`/`costCents` via
//      `parseMoneyToMinor`. Never `x * 100`.
//   2. `quantity` (magnitude) → `quantityDelta` (the API's field name for the
//      same unsigned magnitude). DEBT-028.
//   3. `branchId`, which no form asks for, from the session's operating branch.
//
// Stock is not editable through the product form. Edit changes metadata; every
// movement goes through Adjust Stock and leaves a ledger row with a reason code.
// That single-writer rule is the whole reason the count is worth trusting (BR-02),
// so the drawer's "Initial Stock" field is create-only and the edit path never
// sends a stock value at all.
//
// `isLowStock` comes from the server rather than being recomputed as
// `stock <= reorderPoint` here. The threshold rule belongs to the API; a client
// that derives it will disagree the day the rule gains a nuance.
// ---------------------------------------------------------------------------

import * as React from "react"
import { ColumnDef } from "@tanstack/react-table"
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { Plus, MoreHorizontal, Edit, BarChart2, Search } from "lucide-react"

import { PageHeader } from "@/components/shared/PageHeader"
import { DataTable } from "@/components/shared/DataTable"
import { StatusBadge } from "@/components/shared/StatusBadge"
import { useBreadcrumb } from "@/contexts/breadcrumb-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
import { ProductValues, StockAdjustmentValues } from "@/lib/validation/inventory"
import { useCanPerform } from "@/contexts/role-context"
import { useOperatingBranch } from "@/contexts/session-context"
import { Modules, Actions } from "@/config/permissions"
import { formatMoneyMinor, parseMoneyToMinor } from "@/lib/format/currency"
import { isApiError } from "@/lib/api/client"
import {
  fetchProducts,
  inventoryKeys,
  productKeys,
  type Product,
  type ProductListParams,
} from "@/lib/api/inventory/queries"
import {
  createAdjustment,
  createProduct,
  updateProduct,
  type CreateProductInput,
} from "@/lib/api/inventory/mutations"

const INVENTORY_CRUMBS = [{ label: "Inventory" }] as const

const PAGE_SIZE = 10
const SEARCH_DEBOUNCE_MS = 300

/**
 * Keyed by the label itself, because `StatusBadge` renders `status` as its own
 * text rather than taking children.
 *
 * Out of stock is its own state and not a more severe "low": it blocks a sale
 * outright, while low stock is only a purchasing prompt.
 */
const STOCK_STATUS_VARIANTS: Record<string, "success" | "warning" | "destructive"> = {
  "In Stock": "success",
  "Low Stock": "warning",
  "Out of Stock": "destructive",
}

/**
 * Rupees → paisa, throwing rather than returning null.
 *
 * The form has already refused anything `parseMoneyToMinor` would reject, so a
 * null here means the two validations have drifted apart. Throwing surfaces that
 * as a caught error in the drawer instead of posting `NaN` at a price column.
 */
function toMinor(major: number): number {
  const minor = parseMoneyToMinor(major)
  if (minor === null) {
    throw new Error(`Not a valid amount: ${major}`)
  }
  return minor
}

/** Product → the drawer's form shape. Paisa back to rupees for display. */
function toFormValues(product: Product): ProductValues {
  return {
    name: product.name,
    sku: product.sku,
    category: product.category,
    price: product.priceCents / 100,
    cost: product.costCents / 100,
    uom: product.uom,
    reorderPoint: product.reorderPoint,
    initialStock: 0, // not used in edit mode
  }
}

export default function InventoryPage() {
  useBreadcrumb("Inventory", INVENTORY_CRUMBS as unknown as { label: string; href?: string }[])

  const queryClient = useQueryClient()
  const canWrite = useCanPerform(Modules.INVENTORY, Actions.WRITE)
  const branch = useOperatingBranch()

  // --- Query state ---------------------------------------------------------
  const [pageIndex, setPageIndex] = React.useState(0)
  const [searchInput, setSearchInput] = React.useState("")
  const [search, setSearch] = React.useState("")
  const [lowStockOnly, setLowStockOnly] = React.useState(false)

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim())
      setPageIndex(0)
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [searchInput])

  const params = React.useMemo<ProductListParams>(
    () => ({
      pageIndex,
      pageSize: PAGE_SIZE,
      ...(search === "" ? {} : { search }),
      ...(lowStockOnly ? { lowStock: true } : {}),
    }),
    [pageIndex, search, lowStockOnly]
  )

  const productsQuery = useQuery({
    queryKey: productKeys.list(params),
    queryFn: ({ signal }) => fetchProducts(params, signal),
    placeholderData: keepPreviousData,
  })

  const products = productsQuery.data?.data ?? []
  const pageCount = productsQuery.data?.pagination.pageCount ?? 0
  const total = productsQuery.data?.pagination.total

  // No page clamp effect here. An effect that corrects `pageIndex` after the fact
  // renders the out-of-range page first and fixes it on a second pass — a flash of
  // an empty table plus a request for a page that does not exist. Every way this
  // list can shrink is handled at its cause instead: the search debounce and the
  // low-stock toggle both reset to page 0, and `adjustStock` steps back when it
  // empties the page (below). Growing `pageIndex` is bounded already — `DataTable`
  // disables Next on the last page.

  // --- Dialog state -------------------------------------------------------
  const [drawerOpen, setDrawerOpen] = React.useState(false)
  const [editingProduct, setEditingProduct] = React.useState<
    { values: ProductValues; id: string } | undefined
  >(undefined)

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

  const handleEditProduct = (product: Product) => {
    setEditingProduct({ id: product.id, values: toFormValues(product) })
    setDrawerOpen(true)
  }

  const handleAdjustStock = (product: Product) => {
    setAdjustingProduct({
      id: product.id,
      name: product.name,
      stock: product.stock,
    })
    setDialogOpen(true)
  }

  // --- Mutations ----------------------------------------------------------

  /**
   * One prefix covers the product lists, any cached product detail, and the
   * inventory ledger and alert reads — all of which an adjustment moves.
   */
  const invalidateInventory = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: productKeys.all })
    void queryClient.invalidateQueries({ queryKey: inventoryKeys.all })
  }, [queryClient])

  const saveProduct = useMutation({
    mutationFn: ({ data, id }: { data: ProductValues; id?: string }) => {
      const payload: CreateProductInput = {
        name: data.name,
        sku: data.sku,
        category: data.category,
        priceCents: toMinor(data.price),
        costCents: toMinor(data.cost),
        uom: data.uom,
        reorderPoint: data.reorderPoint,
      }
      if (id !== undefined) {
        // No `initialStock` on the update path — the field does not exist on
        // PATCH, and `forbidNonWhitelisted` would 422 it.
        return updateProduct(id, payload)
      }
      return createProduct({ ...payload, initialStock: data.initialStock })
    },
    onSuccess: (_product, { id }) => {
      invalidateInventory()
      if (id === undefined) setPageIndex(0)
    },
    // No onError: the drawer awaits, catches, and maps the ApiError onto fields.
  })

  const handleSaveProduct = (data: ProductValues) =>
    saveProduct.mutateAsync({ data, id: editingProduct?.id })

  const adjustStock = useMutation({
    mutationFn: (data: StockAdjustmentValues) => {
      if (adjustingProduct === null) {
        throw new Error("No product selected")
      }
      if (branch === null) {
        // Not a validation message dressed up as an error: without a branch there
        // is nothing to file the movement against, and the server would 422.
        throw new Error(
          "No active branch is configured for this business, so stock movements cannot be recorded."
        )
      }
      return createAdjustment({
        productId: adjustingProduct.id,
        branchId: branch.id,
        type: data.type,
        // Same magnitude, the API's name for it. The sign lives in `type`.
        quantityDelta: data.quantity,
        reasonCode: data.reasonCode,
      })
    },
    onSuccess: () => {
      invalidateInventory()
      // Restocking a product past its reorder point drops it out of a low-stock
      // filter. If it was the last row on this page, the page ceases to exist, so
      // step back rather than leaving the table pointed past the end.
      if (lowStockOnly && products.length === 1 && pageIndex > 0) {
        setPageIndex(pageIndex - 1)
      }
    },
  })

  const handleConfirmAdjustment = (data: StockAdjustmentValues) =>
    adjustStock.mutateAsync(data)

  // --- Columns ------------------------------------------------------------
  const columns = React.useMemo<ColumnDef<Product>[]>(() => {
    const cols: ColumnDef<Product>[] = [
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
        accessorKey: "priceCents",
        header: "Price",
        cell: ({ row }) => formatMoneyMinor(row.original.priceCents),
      },
      {
        accessorKey: "stock",
        header: "Stock Level",
        cell: ({ row }) => {
          const { stock, isLowStock, uom } = row.original
          const status =
            stock === 0 ? "Out of Stock" : isLowStock ? "Low Stock" : "In Stock"

          return (
            <div className="flex items-center gap-2">
              <span>
                {stock} {uom}
              </span>
              <StatusBadge
                status={status}
                variantMap={STOCK_STATUS_VARIANTS}
                className="hidden sm:inline-flex"
              />
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
          description={
            total === undefined
              ? "Manage your product catalog and stock levels"
              : `${total} product${total === 1 ? "" : "s"} in the catalog`
          }
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

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search by name or SKU…"
            aria-label="Search products"
            className="pl-9"
          />
        </div>
        <Button
          variant={lowStockOnly ? "default" : "outline"}
          aria-pressed={lowStockOnly}
          onClick={() => {
            setLowStockOnly((current) => !current)
            setPageIndex(0)
          }}
        >
          Low stock only
        </Button>
      </div>

      {canWrite && branch === null && (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          No active branch is configured for this business. Stock adjustments are
          unavailable until one exists — add a branch under Settings.
        </p>
      )}

      <div className="bg-card border rounded-md p-4">
        {productsQuery.isError ? (
          <div className="space-y-3 py-8 text-center">
            <p role="alert" className="text-sm text-destructive">
              {isApiError(productsQuery.error) && productsQuery.error.isForbidden
                ? "You do not have permission to view the product catalog."
                : "Could not load products."}
            </p>
            <Button variant="outline" onClick={() => void productsQuery.refetch()}>
              Try again
            </Button>
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={products}
            isLoading={productsQuery.isPending}
            pageIndex={pageIndex}
            pageSize={PAGE_SIZE}
            pageCount={pageCount}
            onPageChange={setPageIndex}
          />
        )}
      </div>

      <ProductDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        product={editingProduct?.values}
        onSave={handleSaveProduct}
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
