"use client"

// ---------------------------------------------------------------------------
// src/components/dashboard/InsightsCard.tsx
//
// AI Business Health Score + Insights card (FR-AI-03, Phase 1).
//
// Two layers stacked in one card so the operator sees both *the number* and
// *why*:
//
//   1. The score and its components. Computed server-side, deterministic,
//      equal-weighted in v1. Rendered as a small meter + per-component row so
//      the number is never a free-floating figure without its parts.
//
//   2. The insights list. Three entries from the deterministic builder, plus
//      at most one AI-generated entry when a provider is configured. Every
//      `aiGenerated: true` entry is visibly labeled — the badge below the
//      title says so, the body is wrapped in a hint card, and the card header
//      itself carries the AI source. This is BR-08: an AI output is never
//      visually indistinguishable from a deterministic one.
//
// The sparse path (`insufficientData: true`) is treated as a first-class
// state, not a fallback. The score is omitted, the component list is empty,
// and a single sentence explains what is needed. The same rendering rule is
// what the existing section errors use for "could not load" — never a
// fabricated number, never a blank panel.
// ---------------------------------------------------------------------------

import * as React from "react"
import { Sparkles, TrendingUp, TrendingDown, Minus, AlertCircle } from "lucide-react"
import { useQuery } from "@tanstack/react-query"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { insightsKeys, fetchInsights, type HealthGrade, type ScoreComponent, type HealthInsight } from "@/lib/api/dashboard/insights"

const GRADE_LABEL: Record<HealthGrade, string> = {
  good: "Good",
  fair: "Fair",
  poor: "Poor",
}

const GRADE_BADGE_VARIANT: Record<HealthGrade, "success" | "warning" | "destructive"> = {
  good: "success",
  fair: "warning",
  poor: "destructive",
}

const GRADE_PROGRESS: Record<HealthGrade, string> = {
  good: "bg-emerald-500",
  fair: "bg-amber-500",
  poor: "bg-rose-500",
}

export function InsightsCard() {
  const query = useQuery({
    queryKey: insightsKeys.query(undefined),
    queryFn: ({ signal }) => fetchInsights({}, signal),
    // 60s — the score is a trailing window, not a per-second figure.
    staleTime: 60_000,
  })

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle>Business Health</CardTitle>
            <CardDescription>
              {query.data && !query.data.insufficientData
                ? `Score over the last ${daysInWindow(query.data.periodStart, query.data.periodEnd)} days.`
                : "Trend over the last 28 days."}
            </CardDescription>
          </div>
          {query.data?.aiEnabled ? (
            <Badge variant="secondary" className="gap-1">
              <Sparkles className="h-3 w-3" aria-hidden />
              AI insights on
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {query.isError ? (
          <InsightsError onRetry={() => void query.refetch()} />
        ) : query.isPending ? (
          <InsightsSkeleton />
        ) : query.data.insufficientData ? (
          <InsightsSparse />
        ) : (
          <InsightsBody
            score={query.data.score}
            grade={query.data.grade}
            components={query.data.components}
            insights={query.data.insights}
          />
        )}
      </CardContent>
    </Card>
  )
}

function InsightsBody({
  score,
  grade,
  components,
  insights,
}: {
  score: number
  grade: HealthGrade
  components: ScoreComponent[]
  insights: HealthInsight[]
}) {
  return (
    <>
      <div className="flex items-end gap-3">
        <span className="text-3xl font-bold tabular-nums">{Math.round(score)}</span>
        <span className="pb-1 text-sm text-muted-foreground">/ 100</span>
        <Badge variant={GRADE_BADGE_VARIANT[grade]} className="ml-auto">
          {GRADE_LABEL[grade]}
        </Badge>
      </div>
      <ScoreBar score={score} grade={grade} />
      {components.length > 0 ? (
        <ul className="space-y-2 text-sm">
          {components.map((component) => (
            <li key={component.key} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-muted-foreground">
                <ComponentArrow score={component.score} />
                {component.label}
              </span>
              <span className="font-mono text-xs tabular-nums">
                {component.value}
                <span className="ml-2 text-muted-foreground">
                  {Math.round(component.score)}/100
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {insights.length > 0 ? (
        <div className="space-y-2 border-t pt-3">
          {insights.map((insight, idx) => (
            <InsightRow key={`${insight.area}-${idx}`} insight={insight} />
          ))}
        </div>
      ) : null}
    </>
  )
}

function InsightRow({ insight }: { insight: HealthInsight }) {
  return (
    <div
      className={
        insight.aiGenerated
          ? "rounded-md border border-dashed border-primary/40 bg-primary/5 p-3"
          : "rounded-md p-3"
      }
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{insight.title}</span>
        {insight.aiGenerated ? (
          <Badge variant="secondary" className="gap-1 text-[10px]">
            <Sparkles className="h-3 w-3" aria-hidden />
            AI-generated
          </Badge>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{insight.body}</p>
    </div>
  )
}

function ScoreBar({ score, grade }: { score: number; grade: HealthGrade }) {
  const clamped = Math.max(0, Math.min(100, score))
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Business health score"
      className="h-2 w-full overflow-hidden rounded-full bg-muted"
    >
      <div
        className={"h-full transition-[width] " + GRADE_PROGRESS[grade]}
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}

function ComponentArrow({ score }: { score: number }) {
  // 50 is the parity line for a momentum-style component; the arrow is a
  // visual aid, not a verdict.
  if (score >= 60) return <TrendingUp className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
  if (score <= 40) return <TrendingDown className="h-3.5 w-3.5 text-rose-600" aria-hidden />
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
}

function InsightsSparse() {
  return (
    <div className="flex items-start gap-3 rounded-md border border-dashed bg-muted/40 p-4 text-sm">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="space-y-1">
        <p className="font-medium">Not enough data yet.</p>
        <p className="text-muted-foreground">
          Complete a sale or place an order to start the health score. The score
          appears once there is real trading history to base it on — we never
          show a fabricated number.
        </p>
      </div>
    </div>
  )
}

function InsightsError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-destructive/10 px-3 py-2">
      <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
        <AlertCircle className="h-4 w-4" aria-hidden />
        Could not load health insights.
      </p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}

function InsightsSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-9 w-24" />
      <Skeleton className="h-2 w-full" />
      <div className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-5/6" />
      </div>
    </div>
  )
}

function daysInWindow(periodStart: string, periodEnd: string): number {
  // ISO date strings are safe to diff as calendar days. Inclusive both ends
  // so a 28-day window reads as 28, not 27.
  const a = Date.parse(periodStart)
  const b = Date.parse(periodEnd)
  if (Number.isNaN(a) || Number.isNaN(b)) return 28
  return Math.round((b - a) / 86_400_000) + 1
}
