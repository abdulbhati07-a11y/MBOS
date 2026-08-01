import { AppShell } from "@/components/shared/AppShell"
import { ProductsProvider } from "@/contexts/products-context"
import { OrdersProvider } from "@/contexts/orders-context"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <OrdersProvider>
      <ProductsProvider>
        <AppShell>{children}</AppShell>
      </ProductsProvider>
    </OrdersProvider>
  )
}
