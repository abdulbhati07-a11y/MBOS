import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * `GET /dashboard/insights` (FR-AI-03).
 *
 * A trailing-window length selector only — every number behind the score is
 * derived server-side, exactly like the reports this endpoint reads from. The
 * default window is 28 days: long enough to smooth a single quiet day, short
 * enough that "sales this month" reads as current, and a whole number of weeks
 * so the previous-period comparison lines up.
 */
export class InsightsQueryDto {
  /** Window length in days, 7–90. Default 28. */
  @IsOptional()
  @IsString()
  @MaxLength(3)
  days?: string;
}

/**
 * One component of the deterministic health score. Exposed so the UI can show
 * *why* the score is what it is — a number without its parts is exactly the
 * kind of opaque figure the deterministic-score decision exists to avoid.
 */
export interface ScoreComponent {
  key: string;
  label: string;
  /** 0–100 for this component alone. */
  score: number;
  /** The raw figure the component was computed from. */
  value: string;
}

export interface HealthInsight {
  /** One of: 'sales', 'inventory', 'purchasing', 'customers'. */
  area: string;
  title: string;
  body: string;
  /** True only when the text came from the AI provider (BR-08 labeling). */
  aiGenerated: boolean;
}

export interface HealthInsightsResponse {
  /** Deterministic 0–100 score, computed by this service, never by the AI. */
  score: number;
  grade: 'good' | 'fair' | 'poor';
  components: ScoreComponent[];
  insights: HealthInsight[];
  /** Window the figures cover, ISO dates. */
  periodStart: string;
  periodEnd: string;
  /** True when `insights[].body` came from the configured AI provider. */
  aiEnabled: boolean;
  /**
   * When true, there is not enough real history behind the score (the
   * zero-orders case — no fabricated figure, per the UC-03 "not enough data"
   * principle). The UI must render the sparse state, not the score.
   */
  insufficientData: boolean;
}
