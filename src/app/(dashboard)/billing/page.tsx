"use client"

// ---------------------------------------------------------------------------
// src/app/(dashboard)/billing/page.tsx
//
// Section 6.10 — billing, wired to the live API. Replaces the ModulePlaceholder.
//
// Gated on the **settings** module (there is no billing permission): Owner and
// Manager can both read this screen, a Cashier cannot. Only an Owner holds
// `settings.write`, so only an Owner can toggle a module — the switches are
// disabled for a Manager, whose view is otherwise identical.
//
// The module toggle is TWO-STEP (UC-04). Flipping a switch does not change
// anything: it sends a preview (`PATCH` without `confirmed`), and the server's
// reply — a human-readable `message`, and one day a prorated charge (DEBT-018,
// currently always null) — is shown in a confirm dialog. Only "Enable"/"Disable"
// there sends the committing request. The switch is bound to server state, so it
// does not move until the change is confirmed and the list refetches; cancelling
// leaves it exactly where it was.
//
// All money is minor units — `formatMoneyMinor`, never `formatMoney`.
// ---------------------------------------------------------------------------

import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Lock } from "lucide-react"

import { PageHeader } from "@/components/shared/PageHeader"
import { EmptyState } from "@/components/shared/EmptyState"
import { useBreadcrumb } from "@/contexts/breadcrumb-context"
import { useCanPerform } from "@/contexts/role-context"
import { Modules, Actions } from "@/config/permissions"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

import { formatMoneyMinor } from "@/lib/format/currency"
import { isApiError } from "@/lib/api/client"
import {
  billingKeys,
  fetchBillingModules,
  fetchPlans,
  fetchSubscription,
} from "@/lib/api/billing/queries"
import { updateModuleSubscription } from "@/lib/api/billing/mutations"

const BILLING_CRUMBS = [{ label: "Billing" }] as const

/** Friendly names for the three toggleable modules; anything else is titleized. */
const MODULE_LABELS: Record<string, string> = {
  clinic: "Clinic",
  pharmacy: "Pharmacy",
  restaurant: "Restaurant",
}

function moduleLabel(key: string): string {
  return MODULE_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1)
}

function titleize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/** ISO timestamp → medium date, or an em dash for a null/unparseable value. */
function formatDate(value: string | null | undefined): string {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString("en-US", { dateStyle: "medium" })
}

function subscriptionStatusVariant(
  status: string
): "success" | "warning" | "secondary" {
  const s = status.toLowerCase()
  if (s === "active" || s === "trialing") return "success"
  if (s === "past_due" || s === "unpaid") return "warning"
  return "secondary"
}

/**
 * The failed-query state each card shares. A 403 is unreachable behind the page
 * guard, but the server is the authority — so it is called out separately and
 * without a retry, matching the reports page (defence in depth).
 */
function SectionError({
  error,
  resource,
  onRetry,
}: {
  error: unknown
  resource: string
  onRetry: () => void
}) {
  const forbidden = isApiError(error) && error.isForbidden
  return (
    <div className="space-y-3 py-6 text-center">
      <p role="alert" className="text-sm text-destructive">
        {forbidden
          ? `You do not have permission to view ${resource}.`
          : `Could not load ${resource}.`}
      </p>
      {!forbidden && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}

/** The pending toggle awaiting confirmation — seeded from the preview response. */
type PendingToggle = {
  moduleKey: string
  enabled: boolean
  message: string
  effectiveDate: string
}

function toToggleError(err: unknown): string {
  if (isApiError(err)) {
    if (err.isForbidden) return "You do not have permission to change modules."
    // 409 (core module, not toggleable) and everything else carry a usable message.
    return err.message
  }
  return "Could not reach the server. No change was made."
}

export default function BillingPage() {
  useBreadcrumb(
    "Billing",
    BILLING_CRUMBS as unknown as { label: string; href?: string }[]
  )

  const queryClient = useQueryClient()

  // settings.read gates the page; settings.write gates the toggle. A Manager
  // reads but cannot manage.
  const canView = useCanPerform(Modules.SETTINGS, Actions.READ)
  const canManage = useCanPerform(Modules.SETTINGS, Actions.WRITE)

  const [pending, setPending] = React.useState<PendingToggle | null>(null)
  const [toggleError, setToggleError] = React.useState<string | null>(null)

  const modulesQuery = useQuery({
    queryKey: billingKeys.modules(),
    queryFn: ({ signal }) => fetchBillingModules(signal),
    enabled: canView,
  })

  const subscriptionQuery = useQuery({
    queryKey: billingKeys.subscription(),
    queryFn: ({ signal }) => fetchSubscription(signal),
    enabled: canView,
  })

  const plansQuery = useQuery({
    queryKey: billingKeys.plans(),
    queryFn: ({ signal }) => fetchPlans(signal),
    enabled: canView,
  })

  const previewMutation = useMutation({ mutationFn: updateModuleSubscription })
  const commitMutation = useMutation({ mutationFn: updateModuleSubscription })

  // Step 1: flipping a switch previews the change and opens the confirm dialog.
  const startToggle = async (moduleKey: string, enabled: boolean) => {
    setToggleError(null)
    try {
      const preview = await previewMutation.mutateAsync({ moduleKey, enabled })
      if (preview.committed) {
        // Already in the requested state — nothing to confirm. Refresh to be safe.
        await queryClient.invalidateQueries({ queryKey: billingKeys.modules() })
        return
      }
      setPending({
        moduleKey,
        enabled,
        message: preview.message,
        effectiveDate: preview.effectiveDate,
      })
    } catch (err) {
      setToggleError(toToggleError(err))
    }
  }

  // Step 2: confirming sends the same change with `confirmed: true`.
  const confirmToggle = async () => {
    if (pending === null) return
    setToggleError(null)
    try {
      await commitMutation.mutateAsync({
        moduleKey: pending.moduleKey,
        enabled: pending.enabled,
        effectiveDate: pending.effectiveDate,
        confirmed: true,
      })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: billingKeys.modules() }),
        queryClient.invalidateQueries({ queryKey: billingKeys.subscription() }),
      ])
      setPending(null)
    } catch (err) {
      setToggleError(toToggleError(err))
      setPending(null)
    }
  }

  if (!canView) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Billing" description="Plan, subscription, and modules" />
        <EmptyState
          icon={Lock}
          title="Access restricted"
          description="You don't have access to Billing. Contact your manager."
          className="mt-4"
        />
      </div>
    )
  }

  const subscription = subscriptionQuery.data
  const plans = plansQuery.data ?? []
  const modules = modulesQuery.data ?? []
  const switchesDisabled =
    !canManage ||
    previewMutation.isPending ||
    commitMutation.isPending ||
    pending !== null

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Billing"
        description="Plan, subscription, and industry module add-ons"
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── Current subscription ── */}
        <Card>
          <CardHeader>
            <CardTitle>Current subscription</CardTitle>
          </CardHeader>
          <CardContent>
            {subscriptionQuery.isPending ? (
              <div className="space-y-2">
                <Skeleton className="h-7 w-40" />
                <Skeleton className="h-4 w-56" />
              </div>
            ) : subscriptionQuery.isError ? (
              <SectionError
                error={subscriptionQuery.error}
                resource="the subscription"
                onRetry={() => void subscriptionQuery.refetch()}
              />
            ) : !subscription ? (
              <div className="text-sm text-muted-foreground">
                <p className="font-medium text-foreground">No active subscription</p>
                <p className="mt-1">
                  This tenant has not subscribed to a plan yet.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-lg font-semibold">{subscription.plan.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {formatMoneyMinor(subscription.plan.priceMonthly)} / month
                    </p>
                  </div>
                  <Badge variant={subscriptionStatusVariant(subscription.status)}>
                    {titleize(subscription.status.replace(/_/g, " "))}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  Current period: {formatDate(subscription.currentPeriodStart)} –{" "}
                  {formatDate(subscription.currentPeriodEnd)}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Plans ── */}
        <Card>
          <CardHeader>
            <CardTitle>Plans</CardTitle>
            <CardDescription>
              Available plans and the modules each one bundles.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {plansQuery.isPending ? (
              <div className="space-y-3">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : plansQuery.isError ? (
              <SectionError
                error={plansQuery.error}
                resource="plans"
                onRetry={() => void plansQuery.refetch()}
              />
            ) : plans.length === 0 ? (
              <p className="text-sm text-muted-foreground">No plans available.</p>
            ) : (
              <div className="space-y-3">
                {plans.map((plan) => {
                  const current = subscription?.plan.name === plan.name
                  return (
                    <div key={plan.id} className="rounded-md border p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{plan.name}</p>
                          {current && <Badge variant="success">Current</Badge>}
                        </div>
                        <p className="text-sm font-medium whitespace-nowrap">
                          {formatMoneyMinor(plan.priceMonthly)}
                          <span className="font-normal text-muted-foreground">
                            /mo
                          </span>
                        </p>
                      </div>
                      {plan.modules.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {plan.modules.map((mod) => (
                            <Badge key={mod} variant="secondary">
                              {moduleLabel(mod)}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Industry modules ── */}
      <Card>
        <CardHeader>
          <CardTitle>Industry modules</CardTitle>
          <CardDescription>
            Turn industry features on or off. A change takes effect on the next
            request (UC-04). Core modules are always on and are never billed
            separately.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {modulesQuery.isPending ? (
            <>
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </>
          ) : modulesQuery.isError ? (
            <SectionError
              error={modulesQuery.error}
              resource="modules"
              onRetry={() => void modulesQuery.refetch()}
            />
          ) : modules.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No industry modules are available for this tenant.
            </p>
          ) : (
            modules.map((m) => (
              <div
                key={m.moduleKey}
                className="flex items-center justify-between gap-4 rounded-md border p-3"
              >
                <div>
                  <p className="font-medium">{moduleLabel(m.moduleKey)}</p>
                  <p className="text-xs text-muted-foreground">
                    {m.enabled
                      ? m.enabledAt
                        ? `Enabled ${formatDate(m.enabledAt)}`
                        : "Enabled"
                      : "Not enabled"}
                  </p>
                </div>
                <Switch
                  checked={m.enabled}
                  disabled={switchesDisabled}
                  onCheckedChange={(checked) =>
                    void startToggle(m.moduleKey, checked)
                  }
                  aria-label={`${m.enabled ? "Disable" : "Enable"} ${moduleLabel(
                    m.moduleKey
                  )}`}
                />
              </div>
            ))
          )}

          {!canManage && modules.length > 0 && (
            <p className="pt-1 text-xs text-muted-foreground">
              Only an Owner can change module subscriptions.
            </p>
          )}

          {toggleError !== null && (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {toggleError}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Two-step confirm ── */}
      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          // Ignore an auto-close while the commit is in flight; the mutation's
          // own completion clears `pending` and closes the dialog.
          if (!open && !commitMutation.isPending) setPending(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.enabled ? "Enable" : "Disable"}{" "}
              {pending ? moduleLabel(pending.moduleKey) : "module"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.message}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={commitMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={commitMutation.isPending}
              onClick={(e) => {
                e.preventDefault()
                void confirmToggle()
              }}
            >
              {commitMutation.isPending
                ? "Applying…"
                : pending?.enabled
                  ? "Enable"
                  : "Disable"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
