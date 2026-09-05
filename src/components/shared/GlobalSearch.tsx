"use client"

// ---------------------------------------------------------------------------
// src/components/shared/GlobalSearch.tsx
//
// Smart Search input for the AppShell header (FR-AI-01, Phase 1).
//
// The dropdown shows up to `MAX_HITS` (mirrors the backend's cap) products
// found by `GET /api/v1/search?q=`. A hit is the lightweight SearchProductHit
// projection — enough to render a row and a price, not a full product. The
// inventory module already owns the detail and edit surfaces, so a hit
// selection is a navigation to `/inventory?productId=<id>` rather than an
// in-place expansion.
//
// Why the keyboard model: the input is a command palette in the small. Enter
// on a focused row navigates, ArrowUp/Down moves the focus, Escape closes.
// These are the only keys handled here — every other key flows through to the
// underlying <input>, which is what mutates the query.
//
// Permission / no-data states: the backend already collapses a role without
// `inventory.read` to an empty result set (the soft-permission path in
// SearchController), so the empty-state copy is the same for "no matches" and
// "no permission". An actual error is the only state that surfaces the retry
// affordance, because a transient failure deserves a second try and the
// "nothing found" path does not.
// ---------------------------------------------------------------------------

import * as React from "react"
import { useRouter } from "next/navigation"
import { Search, Loader2, AlertCircle, Sparkles } from "lucide-react"
import { useQuery } from "@tanstack/react-query"

import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { searchKeys, fetchSearch, type SearchProductHit } from "@/lib/api/search/queries"
import { formatMoneyMinor } from "@/lib/format/currency"

const MAX_HITS = 20
const MIN_QUERY_LENGTH = 1

const MATCH_BADGE_VARIANT: Record<SearchProductHit["matchedBy"], "default" | "secondary" | "outline"> = {
  vector: "default",
  text: "secondary",
  exact: "outline",
}

const MATCH_LABEL: Record<SearchProductHit["matchedBy"], string> = {
  vector: "AI match",
  text: "Text match",
  exact: "Exact SKU",
}

export function GlobalSearch() {
  const router = useRouter()
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const containerRef = React.useRef<HTMLDivElement | null>(null)

  const [query, setQuery] = React.useState("")
  // `useDeferredValue` keeps typing snappy without firing a request per
  // keystroke — the deferred copy lags behind during a burst of typing and
  // catches up when the input goes quiet. The search query is derived from
  // the deferred value, so the network only sees the settled string.
  const deferredQuery = React.useDeferredValue(query)
  const debounced = deferredQuery.trim()
  const [open, setOpen] = React.useState(false)
  const [userActiveIndex, setUserActiveIndex] = React.useState(0)

  // Click-outside closes the panel. Bound to the wrapper div so the input
  // itself never closes the panel mid-keystroke.
  React.useEffect(() => {
    if (!open) return
    function onPointer(event: PointerEvent): void {
      if (!containerRef.current) return
      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("pointerdown", onPointer)
    return () => document.removeEventListener("pointerdown", onPointer)
  }, [open])

  // Esc closes, '/' focuses. Both are global so the search box is reachable
  // without the user hunting for it with the mouse — this is the one UI affordance
  // every power user expects to type to.
  React.useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setOpen(false)
        inputRef.current?.blur()
        return
      }
      if (event.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        event.preventDefault()
        inputRef.current?.focus()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [])

  const search = useQuery({
    queryKey: searchKeys.query(debounced),
    queryFn: ({ signal }) => fetchSearch(debounced, signal),
    enabled: debounced.length >= MIN_QUERY_LENGTH,
    // Keep previous results visible while a new debounced query is in flight,
    // so a fast typist does not see the panel flash empty.
    placeholderData: (prev) => prev,
    // Stale data is fine for a search box; the next keystroke will refire.
    staleTime: 30_000,
  })

  const hits = search.data?.products.slice(0, MAX_HITS) ?? []
  const showPanel = open && (query.trim().length >= MIN_QUERY_LENGTH)
  // Clamp the highlight to the visible result set. The state reset below
  // returns the user to row 0 on every result change; this clamp protects
  // the moment between the user pressing ArrowDown and the new result set
  // landing, when the cursor would otherwise be stale.
  const activeIndex = Math.min(userActiveIndex, Math.max(0, hits.length - 1))

  // Reset highlight when the result set changes, so ArrowDown lands on row 0
  // of the new set rather than a row that no longer exists. Done during
  // render via the "store the previous prop in state" pattern recommended by
  // the React 19 docs: comparing `prevDebounced` to `debounced` flags the
  // change, and the setter in the same render schedules the reset. No
  // useEffect is involved.
  const [prevDebounced, setPrevDebounced] = React.useState(debounced)
  if (prevDebounced !== debounced) {
    setPrevDebounced(debounced)
    if (userActiveIndex !== 0) setUserActiveIndex(0)
  }

  function navigateToHit(hit: SearchProductHit): void {
    setOpen(false)
    setQuery("")
    inputRef.current?.blur()
    router.push(`/inventory?productId=${encodeURIComponent(hit.id)}`)
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (!showPanel) return
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setUserActiveIndex((idx) => (hits.length === 0 ? 0 : (idx + 1) % hits.length))
      return
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      setUserActiveIndex((idx) =>
        hits.length === 0 ? 0 : (idx - 1 + hits.length) % hits.length,
      )
      return
    }
    if (event.key === "Enter") {
      const hit = hits[activeIndex]
      if (hit) {
        event.preventDefault()
        navigateToHit(hit)
      }
    }
  }

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls="global-search-listbox"
          aria-autocomplete="list"
          aria-activedescendant={
            showPanel && hits[activeIndex]
              ? `global-search-hit-${hits[activeIndex].id}`
              : undefined
          }
          placeholder="Search products…"
          className="pl-8 pr-12"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {search.isFetching ? (
          <Loader2
            className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground"
            aria-label="Searching"
          />
        ) : (
          <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground sm:inline-flex">
            /
          </kbd>
        )}
      </div>

      {showPanel ? (
        <div
          id="global-search-listbox"
          role="listbox"
          className="absolute left-0 right-0 z-50 mt-1 max-h-96 overflow-auto rounded-md border bg-popover text-popover-foreground shadow-md"
        >
          {search.isError ? (
            <SearchErrorState onRetry={() => void search.refetch()} />
          ) : search.isPending && !search.data ? (
            <SearchEmptyState>Searching…</SearchEmptyState>
          ) : hits.length === 0 ? (
            <SearchEmptyState>
              No products match &ldquo;{debounced}&rdquo;.
            </SearchEmptyState>
          ) : (
            <ul className="py-1">
              {hits.map((hit, idx) => (
                <SearchHitRow
                  key={hit.id}
                  hit={hit}
                  active={idx === activeIndex}
                  onMouseEnter={() => setUserActiveIndex(idx)}
                  onSelect={() => navigateToHit(hit)}
                />
              ))}
            </ul>
          )}
          {search.data && search.data.engine === "text" ? (
            <div className="flex items-center gap-1.5 border-t px-3 py-2 text-[11px] text-muted-foreground">
              <Sparkles className="h-3 w-3" aria-hidden />
              Text search — set AI_API_KEY to enable semantic matching.
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function SearchHitRow({
  hit,
  active,
  onMouseEnter,
  onSelect,
}: {
  hit: SearchProductHit
  active: boolean
  onMouseEnter: () => void
  onSelect: () => void
}) {
  return (
    <li
      id={`global-search-hit-${hit.id}`}
      role="option"
      aria-selected={active}
      onMouseDown={(e) => {
        // onMouseDown (not onClick) so the input's blur does not close the
        // panel before the navigation fires. preventDefault stops the input
        // from losing focus before the click is registered.
        e.preventDefault()
        onSelect()
      }}
      onMouseEnter={onMouseEnter}
      className={
        "flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm " +
        (active ? "bg-accent text-accent-foreground" : "hover:bg-accent/50")
      }
    >
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{hit.name}</div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">{hit.sku}</span>
          <span aria-hidden>·</span>
          <span className="truncate">{hit.category}</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant={MATCH_BADGE_VARIANT[hit.matchedBy]} className="text-[10px]">
          {MATCH_LABEL[hit.matchedBy]}
        </Badge>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {formatMoneyMinor(hit.priceCents)}
        </span>
      </div>
    </li>
  )
}

function SearchEmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 py-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}

function SearchErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-3 text-sm">
      <span className="flex items-center gap-2 text-destructive">
        <AlertCircle className="h-4 w-4" aria-hidden />
        Search failed.
      </span>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}
