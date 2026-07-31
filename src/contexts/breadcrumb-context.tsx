"use client"

import * as React from "react"

type Crumb = {
  label: string
  href?: string
}

type BreadcrumbContextValue = {
  title: string
  crumbs: Crumb[]
  setBreadcrumb: (title: string, crumbs: Crumb[]) => void
}

const BreadcrumbContext = React.createContext<BreadcrumbContextValue>({
  title: "",
  crumbs: [],
  setBreadcrumb: () => {},
})

export function BreadcrumbProvider({ children }: { children: React.ReactNode }) {
  const [title, setTitle] = React.useState("")
  const [crumbs, setCrumbs] = React.useState<Crumb[]>([])

  // Stable identity — will not cause downstream effect re-fires
  const setBreadcrumb = React.useCallback(
    (newTitle: string, newCrumbs: Crumb[]) => {
      setTitle(newTitle)
      setCrumbs(newCrumbs)
    },
    []
  )

  const value = React.useMemo(
    () => ({ title, crumbs, setBreadcrumb }),
    [title, crumbs, setBreadcrumb]
  )

  return (
    <BreadcrumbContext.Provider value={value}>
      {children}
    </BreadcrumbContext.Provider>
  )
}

/**
 * Read breadcrumb state from context (used by AppShell header).
 */
export function useBreadcrumbContext() {
  return React.useContext(BreadcrumbContext)
}

/**
 * Set breadcrumb for the current page.
 *
 * `crumbs` should be a stable reference (module-level constant or useMemo)
 * to avoid unnecessary effect re-runs. The hook uses JSON.stringify internally
 * as the effect dependency to tolerate unstable array identity gracefully.
 */
export function useBreadcrumb(title: string, crumbs: Crumb[]) {
  const { setBreadcrumb } = useBreadcrumbContext()
  const serialized = JSON.stringify(crumbs)

  React.useEffect(() => {
    setBreadcrumb(title, JSON.parse(serialized) as Crumb[])
  }, [title, serialized, setBreadcrumb])
}
