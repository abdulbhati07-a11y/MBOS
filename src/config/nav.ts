import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Users,
  ShoppingBag,
  BarChart3,
  Settings,
  ShieldAlert,
  UserCog,
  CreditCard,
  Stethoscope,
  Pill,
  Utensils,
  type LucideIcon,
} from "lucide-react"

export type NavItem = {
  label: string
  href: string
  icon: LucideIcon
  moduleKey: string
}

export type NavGroup = {
  label: string
  items: NavItem[]
}

export const navConfig: NavGroup[] = [
  {
    label: "Core",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, moduleKey: "dashboard" },
      { label: "Inventory", href: "/inventory", icon: Package, moduleKey: "inventory" },
      { label: "Sales/POS", href: "/sales", icon: ShoppingCart, moduleKey: "sales" },
      { label: "Customers", href: "/customers", icon: Users, moduleKey: "customers" },
      { label: "Purchases", href: "/purchases", icon: ShoppingBag, moduleKey: "purchases" },
      { label: "Reports", href: "/reports", icon: BarChart3, moduleKey: "reports" },
    ],
  },
  {
    label: "Industry",
    items: [
      { label: "Clinic", href: "/clinic", icon: Stethoscope, moduleKey: "clinic" },
      { label: "Pharmacy", href: "/pharmacy", icon: Pill, moduleKey: "pharmacy" },
      { label: "Restaurant", href: "/restaurant", icon: Utensils, moduleKey: "restaurant" },
    ],
  },
  {
    label: "Admin",
    items: [
      { label: "Settings", href: "/settings", icon: Settings, moduleKey: "settings" },
      { label: "Users", href: "/users", icon: UserCog, moduleKey: "settings" },
      { label: "Roles", href: "/roles", icon: ShieldAlert, moduleKey: "settings" },
      { label: "Billing", href: "/billing", icon: CreditCard, moduleKey: "settings" },
    ],
  },
]
