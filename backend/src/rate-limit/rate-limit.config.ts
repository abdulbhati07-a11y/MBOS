import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Rate-limit thresholds (Section 6.1, step 2 of the chain in Section 6.2).
 *
 * ============================ DEBT-013 ============================
 * Every number below is INTERIM. Section 6.1 specifies the mechanism — per-tenant
 * for authenticated traffic, stricter per-IP on the unauthenticated auth
 * endpoints, a burst allowance, `429` plus `Retry-After` — but marks all numeric
 * values TBD pending a product decision. These defaults were chosen to be
 * defensible rather than authoritative:
 *
 *   AUTH_IP_PER_MINUTE = 10   A human logging in needs a handful of attempts;
 *                             credential stuffing needs thousands. Ten per
 *                             minute per IP leaves room for typos and a shared
 *                             office NAT while making online guessing useless.
 *   GLOBAL_IP_PER_MINUTE = 120  Ceiling for anything else arriving from one IP
 *                             before authentication is known.
 *   TENANT_PER_MINUTE = 300   ~5 requests/second sustained for a whole tenant,
 *                             comfortably above an interactive UI's needs.
 *   BURST_MULTIPLIER = 1.5    Short spikes (a dashboard opening several widgets
 *                             at once) are absorbed rather than throttled.
 *
 * Resolving DEBT-013 should mean editing the env vars or these defaults — not
 * touching the guard or the service.
 * =================================================================
 */

/** Every window in this design is one minute; kept explicit for the maths. */
export const RATE_LIMIT_WINDOW_MS = 60_000;

export const RATE_LIMIT_DEFAULTS = {
  authIpPerMinute: 10,
  globalIpPerMinute: 120,
  tenantPerMinute: 300,
  burstMultiplier: 1.5,
} as const;

/**
 * Resolved limits, read once at construction.
 *
 * Env overrides exist so the thresholds can be tuned per environment (and so the
 * test suite can make them tiny or switch limiting off) without a code change.
 */
@Injectable()
export class RateLimitConfig {
  readonly enabled: boolean;
  readonly authIpLimit: number;
  readonly globalIpLimit: number;
  readonly tenantLimit: number;

  constructor(config: ConfigService) {
    this.enabled = config.get<string>('RATE_LIMIT_ENABLED') !== 'false';

    const burst = numberFrom(
      config,
      'RATE_LIMIT_BURST_MULTIPLIER',
      RATE_LIMIT_DEFAULTS.burstMultiplier,
    );

    // The burst allowance is folded into the effective ceiling rather than
    // tracked as a second window: with a one-minute sliding window, permitting
    // `limit * multiplier` events is what "a short burst above the per-minute
    // rate" means in practice, and it keeps one counter per key instead of two.
    this.authIpLimit = ceilingFor(
      numberFrom(
        config,
        'RATE_LIMIT_AUTH_IP_PER_MINUTE',
        RATE_LIMIT_DEFAULTS.authIpPerMinute,
      ),
      burst,
    );
    this.globalIpLimit = ceilingFor(
      numberFrom(
        config,
        'RATE_LIMIT_GLOBAL_IP_PER_MINUTE',
        RATE_LIMIT_DEFAULTS.globalIpPerMinute,
      ),
      burst,
    );
    this.tenantLimit = ceilingFor(
      numberFrom(
        config,
        'RATE_LIMIT_TENANT_PER_MINUTE',
        RATE_LIMIT_DEFAULTS.tenantPerMinute,
      ),
      burst,
    );
  }
}

function ceilingFor(perMinute: number, burstMultiplier: number): number {
  return Math.max(1, Math.ceil(perMinute * burstMultiplier));
}

function numberFrom(
  config: ConfigService,
  key: string,
  fallback: number,
): number {
  const raw = config.get<string>(key);
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `${key} must be a positive number when set; received "${raw}".`,
    );
  }
  return parsed;
}
