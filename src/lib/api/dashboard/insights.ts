// ---------------------------------------------------------------------------
// src/lib/api/dashboard/insights.ts
//
// Read side of `GET /api/v1/dashboard/insights` (FR-AI-03, Phase 1).
//
// The endpoint is gated on `dashboard.read`, which every role holds, so the
// hook can fire unconditionally — no `canView` flag, unlike the per-snapshot
// metrics the dashboard composes from the other modules. The sparse state
// (`insufficientData: true`) is reported by the server, never guessed here:
// the score is not rendered when there are no orders in the window.
//
// Every AI-generated insight carries `aiGenerated: true` on the wire. The UI
// labels those entries visibly (BR-08) — this module does not infer that
// status from anything else, so a field name change in the backend breaks the
// build rather than going silent.
// ---------------------------------------------------------------------------

import { api } from "../client"

export type HealthGrade = "good" | "fair" | "poor"

export interface ScoreComponent {
  key: string
  label: string
  /** 0–100 for this component alone. */
  score: number
  /** The raw figure the component was computed from, as a formatted string. */
  value: string
}

export interface HealthInsight {
  area: "sales" | "inventory" | "purchasing" | "customers"
  title: string
  body: string
  /** True only when the text came from the configured AI provider. */
  aiGenerated: boolean
}

export interface HealthInsightsResponse {
  /** Deterministic 0–100 score, computed server-side. */
  score: number
  grade: HealthGrade
  components: ScoreComponent[]
  insights: HealthInsight[]
  /** ISO date (YYYY-MM-DD). */
  periodStart: string
  /** ISO date (YYYY-MM-DD). */
  periodEnd: string
  aiEnabled: boolean
  /**
   * True when there is not enough real history to back the score. The UI must
   * render the sparse state in that case rather than the figure.
   */
  insufficientData: boolean
}

export interface InsightsParams {
  /** Trailing window length in days, 7–90. Default 28 server-side. */
  days?: number
}

export const insightsKeys = {
  all: ["insights"] as const,
  query: (days: number | undefined) =>
    [...insightsKeys.all, days ?? "default"] as const,
}

export function fetchInsights(
  params: InsightsParams = {},
  signal?: AbortSignal,
): Promise<HealthInsightsResponse> {
  return api.get<HealthInsightsResponse>("/dashboard/insights", {
    query: { ...(params.days === undefined ? {} : { days: params.days }) },
    signal,
  })
}
