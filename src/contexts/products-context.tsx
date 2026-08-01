"use client"

// ---------------------------------------------------------------------------
// src/contexts/products-context.tsx
//
// Shared live product state for Inventory and Sales modules.
//
// ProductsProvider wraps the dashboard layout so all dashboard pages share
// one products array. Inventory writes to it (add/edit/adjust stock);
// Sales reads from it for the POS stock warning (PROV-BR-07).
//
// Without this context, Inventory page-local state changes would never
// propagate to Sales' stock warning — the same stale-data failure mode
// as DEBT-004. Lifting to shared context resolves it structurally.
//
// DEBT-006 analogue: this context is backed by React state seeded from
// MOCK_PRODUCTS. When a real backend exists, replace the useState initialiser
// with an API fetch; all consumers (useProducts, useSetProducts) require
// no changes.
// ---------------------------------------------------------------------------

import * as React from "react"
import { MOCK_PRODUCTS, ProductRecord } from "@/lib/mock-data/products"

type ProductsContextValue = {
  products: ProductRecord[]
  setProducts: React.Dispatch<React.SetStateAction<ProductRecord[]>>
}

const ProductsContext = React.createContext<ProductsContextValue | null>(null)

export function ProductsProvider({ children }: { children: React.ReactNode }) {
  const [products, setProducts] = React.useState<ProductRecord[]>(MOCK_PRODUCTS)

  const value = React.useMemo(
    () => ({ products, setProducts }),
    [products]
  )

  return (
    <ProductsContext.Provider value={value}>
      {children}
    </ProductsContext.Provider>
  )
}

function useProductsContext(): ProductsContextValue {
  const ctx = React.useContext(ProductsContext)
  if (!ctx) {
    throw new Error("useProductsContext must be used within a ProductsProvider")
  }
  return ctx
}

/** Read the live products array. */
export function useProducts(): ProductRecord[] {
  return useProductsContext().products
}

/** Write to the live products array. Used only by the Inventory page. */
export function useSetProducts(): React.Dispatch<React.SetStateAction<ProductRecord[]>> {
  return useProductsContext().setProducts
}
