"use client"

// ---------------------------------------------------------------------------
// src/components/settings/CompanyProfileForm.tsx
//
// Company profile settings form — React state only, no backend persistence.
//
// Default tax rate field is informational only in this pass.
// TODO: DEBT-008 — wire defaultTaxRate into NewOrderForm's tax rate input
// once a settings context or API exists.
//
// The currency field is an ISO 4217 *code*, not a display symbol — that is what
// TenantSettings.currencyCode stores (default PKR), and the display symbol is
// derived from it in src/lib/format/currency.ts rather than typed by a user.
// See DEBT-024: changing the code does not convert stored amounts, so once a
// tenant has orders this field needs a guard rather than a free-text input.
// ---------------------------------------------------------------------------

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CURRENCY_CODE } from "@/lib/format/currency"

type CompanyProfileValues = {
  companyName: string
  defaultTaxRate: string
  currencyCode: string
  timezone: string
}

const DEFAULTS: CompanyProfileValues = {
  companyName: "Acme Corp",
  defaultTaxRate: "0",
  currencyCode: CURRENCY_CODE,
  timezone: "UTC",
}

export function CompanyProfileForm() {
  const [values, setValues] = React.useState<CompanyProfileValues>(DEFAULTS)
  const [saved, setSaved] = React.useState(false)

  const handleChange = (field: keyof CompanyProfileValues) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setValues((prev) => ({ ...prev, [field]: e.target.value }))
      setSaved(false)
    }

  const handleSave = () => {
    // No backend — log to console and show a transient saved indicator.
    // TODO: DEBT-008 — persist to settings API when backend exists.
    console.log("Company profile save (mock):", values)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="max-w-lg space-y-6">
      <div className="space-y-1.5">
        <Label htmlFor="companyName">Company Name</Label>
        <Input
          id="companyName"
          value={values.companyName}
          onChange={handleChange("companyName")}
          placeholder="e.g. Acme Corp"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="defaultTaxRate">
            Default Tax Rate (%)
          </Label>
          <Input
            id="defaultTaxRate"
            type="number"
            min={0}
            max={100}
            step={0.1}
            value={values.defaultTaxRate}
            onChange={handleChange("defaultTaxRate")}
          />
          <p className="text-xs text-muted-foreground">
            Informational only — not yet wired to the POS tax field. (DEBT-008)
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="currencyCode">Currency Code</Label>
          <Input
            id="currencyCode"
            value={values.currencyCode}
            onChange={handleChange("currencyCode")}
            placeholder="e.g. PKR"
            maxLength={3}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="timezone">Timezone</Label>
        <Input
          id="timezone"
          value={values.timezone}
          onChange={handleChange("timezone")}
          placeholder="e.g. UTC, Asia/Karachi"
        />
      </div>

      <div className="flex items-center gap-3 pt-2">
        <Button onClick={handleSave}>Save Changes</Button>
        {saved && (
          <span className="text-sm text-success">Saved (local only)</span>
        )}
      </div>
    </div>
  )
}
