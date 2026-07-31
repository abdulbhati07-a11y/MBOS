"use client"

import * as React from "react"
import Link from "next/link"
import { ColumnDef } from "@tanstack/react-table"
import {
  DollarSign,
  ShoppingCart,
  Users,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Plus,
  Package,
  UserPlus,
  BarChart3,
} from "lucide-react"

import { PageHeader } from "@/components/shared/PageHeader"
import { DataTable } from "@/components/shared/DataTable"
import { StatusBadge } from "@/components/shared/StatusBadge"
import { useBreadcrumb } from "@/contexts/breadcrumb-context"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

// ---------------------------------------------------------------------------
// Breadcrumb — module-level constant for stable reference
// ---------------------------------------------------------------------------
const DASHBOARD_CRUMBS = [{ label: "Dashboard" }] as const

// ---------------------------------------------------------------------------
// KPI Stat Card data (static)
// ---------------------------------------------------------------------------
const stats = [
  {
    title: "Total Revenue",
    value: "$45,231.89",
    delta: "+20.1% from last month",
    trend: "up" as const,
    icon: DollarSign,
  },
  {
    title: "Active Orders",
    value: "+2,350",
    delta: "+180.1% from last month",
    trend: "up" as const,
    icon: ShoppingCart,
  },
  {
    title: "Total Customers",
    value: "+12,234",
    delta: "+19% from last month",
    trend: "up" as const,
    icon: Users,
  },
  {
    title: "Low Stock Items",
    value: "7",
    delta: "-4 from last week",
    trend: "down" as const,
    icon: AlertTriangle,
  },
]

// ---------------------------------------------------------------------------
// Recent Transactions — static data + column definitions
// ---------------------------------------------------------------------------
type Transaction = {
  id: string
  customer: string
  amount: string
  status: "completed" | "pending" | "failed"
  date: string
}

const transactions: Transaction[] = [
  { id: "TXN-001", customer: "Alice Johnson", amount: "$250.00", status: "completed", date: "Jul 30, 2026" },
  { id: "TXN-002", customer: "Bob Smith", amount: "$1,200.00", status: "completed", date: "Jul 30, 2026" },
  { id: "TXN-003", customer: "Charlie Brown", amount: "$89.99", status: "pending", date: "Jul 29, 2026" },
  { id: "TXN-004", customer: "Diana Prince", amount: "$540.00", status: "completed", date: "Jul 29, 2026" },
  { id: "TXN-005", customer: "Evan Rogers", amount: "$175.50", status: "failed", date: "Jul 28, 2026" },
]

const transactionColumns: ColumnDef<Transaction>[] = [
  {
    accessorKey: "customer",
    header: "Customer",
  },
  {
    accessorKey: "amount",
    header: "Amount",
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => {
      const status = row.getValue("status") as Transaction["status"]
      const variantMap: Record<string, "success" | "warning" | "destructive"> = {
        completed: "success",
        pending: "warning",
        failed: "destructive",
      }
      return <StatusBadge status={status} variantMap={variantMap} />
    },
  },
  {
    accessorKey: "date",
    header: "Date",
  },
]

// ---------------------------------------------------------------------------
// Quick Actions
// ---------------------------------------------------------------------------
const quickActions = [
  { label: "New Sale", href: "/sales", icon: Plus },
  { label: "Add Product", href: "/inventory", icon: Package },
  { label: "New Customer", href: "/customers", icon: UserPlus },
  { label: "View Reports", href: "/reports", icon: BarChart3 },
]

// ---------------------------------------------------------------------------
// Recent Activity (static)
// ---------------------------------------------------------------------------
const recentActivity = [
  { text: "John added 12 units of Product X to inventory", time: "2 min ago" },
  { text: "Alice Johnson completed order #TXN-001", time: "15 min ago" },
  { text: "New customer Diana Prince registered", time: "1 hr ago" },
  { text: "Bob Smith placed order #TXN-002 for $1,200", time: "2 hrs ago" },
  { text: "Low stock alert triggered for 3 items", time: "5 hrs ago" },
]

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------
export default function DashboardPage() {
  useBreadcrumb("Dashboard", DASHBOARD_CRUMBS as unknown as { label: string; href?: string }[])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Dashboard"
        description="Overview of your business at a glance"
      />

      {/* KPI Stat Cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.title}
              </CardTitle>
              <stat.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <p className={`text-xs mt-1 flex items-center gap-1 ${
                stat.trend === "up" ? "text-success" : "text-warning"
              }`}>
                {stat.trend === "up" ? (
                  <TrendingUp className="h-3 w-3" />
                ) : (
                  <TrendingDown className="h-3 w-3" />
                )}
                {stat.delta}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* TODO: FR-AI-03 — Health Score Card and AI Insights list will be added here once AI backend exists */}

      {/* Two-Column Layout */}
      <div className="grid gap-6 grid-cols-1 lg:grid-cols-5">
        {/* Left Column — Recent Transactions */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Recent Transactions</CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={transactionColumns}
              data={transactions}
              pageCount={1}
              pageIndex={0}
              pageSize={10}
            />
          </CardContent>
        </Card>

        {/* Right Column */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              {quickActions.map((action) => (
                <Button
                  key={action.label}
                  variant="outline"
                  className="h-auto flex flex-col items-center gap-2 py-4"
                  render={<Link href={action.href} />}
                >
                  <action.icon className="h-5 w-5" />
                  <span className="text-xs">{action.label}</span>
                </Button>
              ))}
            </CardContent>
          </Card>

          {/* Recent Activity */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-4">
                {recentActivity.map((item, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm leading-snug">{item.text}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{item.time}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
