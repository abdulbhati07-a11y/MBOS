"use client"

// ---------------------------------------------------------------------------
// src/components/settings/CompanyProfileForm.tsx
//
// Company profile — the first form in the app on the real API. Closes DEBT-008's
// read half: the tenant's tax rate is now readable, so `NewOrderForm` no longer
// has to hardcode 0.
//
// Two conversions happen at this boundary and both are one-way traps if missed:
//
//   - **The tax rate is basis points on the wire, percent in the input.** 800 is
//     8.00%. The field shows "8.00" and sends 800. `Math.round(pct * 100)` is not
//     used for the conversion — see `parseTaxRatePercentToBps`.
//   - **A non-integer rate is refused, not rounded.** Basis points are already
//     hundredths of a percent; rounding "8.155" would store a rate the user never
//     chose and then multiply money by it.
//
// The currency field is deliberately read-only. Nothing converts stored amounts
// when it changes: every money column holds minor units of whatever this code
// says, so switching a tenant with existing orders from PKR to USD reinterprets
// 299900 paisa as $2,999.00 — the digits stay and the meaning moves, and Section
// 6.4 defines no endpoint to undo it (DEBT-024). Until there is a conversion
// path, a free-text input here is a data-loss button.
// ---------------------------------------------------------------------------

import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { useCanPerform } from "@/contexts/role-context"
import { Modules, Actions } from "@/config/permissions"
import { isApiError } from "@/lib/api/client"
import {
  fetchSettings,
  parseTaxRatePercentToBps,
  settingsKeys,
  taxRateBpsToPercentInput,
  type TenantSettings,
} from "@/lib/api/settings/queries"
import { updateSettings } from "@/lib/api/settings/mutations"

/** The form's own shape: every field a string, because that is what inputs hold. */
interface FormValues {
  companyName: string
  /** Percent, e.g. "8.00". Converted to basis points on submit. */
  taxRatePercent: string
  timezone: string
}

function toFormValues(settings: TenantSettings): FormValues {
  return {
    companyName: settings.companyName,
    taxRatePercent: taxRateBpsToPercentInput(settings.defaultTaxRateBps),
    timezone: settings.timezone,
  }
}

type FieldErrors = Partial<Record<keyof FormValues, string>>

/**
 * The fields, mounted only once the settings have loaded.
 *
 * The seeding rule this enforces: the form takes its initial values from the fetch
 * that first landed, and never re-seeds from the query afterwards. Re-seeding on
 * every query update would wipe whatever the user was mid-way through typing the
 * moment anything invalidated the cache — and something does, because saving writes
 * the response into this very key.
 *
 * Splitting it out is what makes that a property of the code rather than a rule to
 * remember. `useState` runs its initialiser on mount and ignores later prop
 * changes, so the "seed once" behaviour is structural; the previous shape — one
 * component with `values: FormValues | null` and an effect doing
 * `setValues(current => current ?? …)` — had to encode the same invariant inside a
 * setter, and paid a render for it.
 */
function CompanyProfileFields({ settings }: { settings: TenantSettings }) {
  const queryClient = useQueryClient()
  const canWrite = useCanPerform(Modules.SETTINGS, Actions.WRITE)

  const [values, setValues] = React.useState<FormValues>(() =>
    toFormValues(settings),
  )
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({})
  const [formError, setFormError] = React.useState<string | null>(null)
  const [savedAt, setSavedAt] = React.useState<number | null>(null)

  const save = useMutation({
    mutationFn: updateSettings,
    onSuccess: (updated) => {
      // Write the server's answer straight into the cache rather than
      // invalidating. The response *is* the new settings, so a refetch would be a
      // second round trip to learn what we already hold — and any other reader of
      // this key (the tax rate on the order form) updates in the same tick.
      queryClient.setQueryData(settingsKeys.tenant(), updated)
      setValues(toFormValues(updated))
      setFieldErrors({})
      setFormError(null)
      setSavedAt(Date.now())
    },
    onError: (err) => {
      setSavedAt(null)
      if (isApiError(err) && err.isValidation) {
        // Map the server's field names back onto the form's. `defaultTaxRateBps`
        // is a different field from the one the user typed into, so the message
        // has to be re-homed or it lands nowhere.
        const server = err.fieldErrors()
        setFieldErrors({
          companyName: server.companyName,
          taxRatePercent: server.defaultTaxRateBps,
          timezone: server.timezone,
        })
        setFormError(null)
        return
      }
      if (isApiError(err) && err.isForbidden) {
        setFormError("You do not have permission to change these settings.")
        return
      }
      setFormError(
        isApiError(err)
          ? err.message
          : "Could not reach the server. Your changes were not saved.",
      )
    },
  })

  function handleChange(field: keyof FormValues) {
    return (event: React.ChangeEvent<HTMLInputElement>) => {
      const next = event.target.value
      setValues((current) => ({ ...current, [field]: next }))
      setFieldErrors((current) => ({ ...current, [field]: undefined }))
      setSavedAt(null)
    }
  }

  function handleSave() {
    const bps = parseTaxRatePercentToBps(values.taxRatePercent)
    if (bps === null) {
      setFieldErrors({
        taxRatePercent:
          "Enter a rate between 0 and 100 with at most two decimal places.",
      })
      return
    }

    setFieldErrors({})
    save.mutate({
      companyName: values.companyName,
      defaultTaxRateBps: bps,
      timezone: values.timezone,
    })
  }

  const currencyCode = settings.currencyCode

  return (
    <div className="max-w-lg space-y-6">
      <div className="space-y-1.5">
        <Label htmlFor="companyName">Company Name</Label>
        <Input
          id="companyName"
          value={values.companyName}
          onChange={handleChange("companyName")}
          placeholder="e.g. Acme Corp"
          disabled={!canWrite}
          aria-invalid={fieldErrors.companyName !== undefined}
        />
        {fieldErrors.companyName !== undefined && (
          <p className="text-xs text-destructive">{fieldErrors.companyName}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="taxRatePercent">Default Tax Rate (%)</Label>
          <Input
            id="taxRatePercent"
            inputMode="decimal"
            value={values.taxRatePercent}
            onChange={handleChange("taxRatePercent")}
            disabled={!canWrite}
            aria-invalid={fieldErrors.taxRatePercent !== undefined}
          />
          {fieldErrors.taxRatePercent === undefined ? (
            <p className="text-xs text-muted-foreground">
              Applied to new sales unless the order overrides it.
            </p>
          ) : (
            <p className="text-xs text-destructive">
              {fieldErrors.taxRatePercent}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="currencyCode">Currency Code</Label>
          <Input id="currencyCode" value={currencyCode} readOnly disabled />
          <p className="text-xs text-muted-foreground">
            Set at tenant setup. Changing it would not convert existing amounts.
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="timezone">Timezone</Label>
        <Input
          id="timezone"
          value={values.timezone}
          onChange={handleChange("timezone")}
          placeholder="e.g. UTC, Asia/Karachi"
          disabled={!canWrite}
          aria-invalid={fieldErrors.timezone !== undefined}
        />
        {fieldErrors.timezone !== undefined && (
          <p className="text-xs text-destructive">{fieldErrors.timezone}</p>
        )}
      </div>

      {formError !== null && (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {formError}
        </p>
      )}

      {canWrite ? (
        <div className="flex items-center gap-3 pt-2">
          <Button onClick={handleSave} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save Changes"}
          </Button>
          {savedAt !== null && (
            <span className="text-sm text-success" role="status">
              Saved
            </span>
          )}
        </div>
      ) : (
        <p className="pt-2 text-sm text-muted-foreground">
          You have read-only access to these settings.
        </p>
      )}
    </div>
  )
}

export function CompanyProfileForm() {
  const settingsQuery = useQuery({
    queryKey: settingsKeys.tenant(),
    queryFn: ({ signal }) => fetchSettings(signal),
  })

  if (settingsQuery.isPending) {
    return (
      <div className="max-w-lg space-y-6" aria-busy="true">
        <span className="sr-only">Loading company settings…</span>
        <Skeleton className="h-16 w-full" />
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }

  if (settingsQuery.isError) {
    return (
      <div className="max-w-lg space-y-3">
        <p role="alert" className="text-sm text-destructive">
          Could not load company settings.
        </p>
        <Button variant="outline" onClick={() => void settingsQuery.refetch()}>
          Try again
        </Button>
      </div>
    )
  }

  return <CompanyProfileFields settings={settingsQuery.data} />
}
