import { AppShell } from "@/components/shared/AppShell"
import { ProductsProvider } from "@/contexts/products-context"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <ProductsProvider>
      <AppShell>{children}</AppShell>
    </ProductsProvider>
  )
}
