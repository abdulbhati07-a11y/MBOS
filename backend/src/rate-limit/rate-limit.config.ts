import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Rate-limit thresholds (Section 6.1, step 2 of the chain in Section 6.2).
 *
 * ===================== DEBT-013 — RESOLVED =====================
 * Section 6.1 fixes the mechanism (per-tenant for authenticated traffic,
 * stricter per-IP on the unauthenticated auth endpoints, a burst allowance,
 * `429` plus `Retry-After`) and left the numbers to a product decision. Those
 * numbers are now decided and are the defaults below — no longer interim:
 *
 *   Authenticated API, per tenant : 300 req/min, burst 50   → 350 effective
 *   Auth endpoints, per IP        :  10 req/min, burst  3   →  13 effective
 *   Everything else pre-auth, /IP : 120 req/min, burst 40   → 160 effective
 *
 * The per-tenant ceiling is ~5 req/s sustained, comfortably above an interactive
 * UI's needs, with 50 spare for a dashboard opening several widgets at once. The
 * auth per-IP ceiling leaves room for typos and a shared office NAT while making
 * online credential guessing useless. The global per-IP ceiling bounds anything
 * else arriving from one address before its tenant is known.
 *
 * Burst is ADDITIVE per category (perMinute + burst), not a shared multiplier:
 * "burst 50" in the decision is 50 extra requests, so it is added, not scaled.
 * It is folded into a single effective ceiling rather than tracked as a second
 * window — with a one-minute sliding window, permitting `perMinute + burst`
 * events per key is exactly what "a short burst above the rate" means, and it
 * keeps one counter per key instead of two.
 *
 * PROXY TRUST (part of this decision): the per-IP limits are only sound if the
 * client IP cannot be spoofed. `X-Forwarded-For` must NEVER be trusted
 * unconditionally — Express's `trust proxy` is configured in main.ts from the
 * TRUST_PROXY env var (a pinned proxy IP/CIDR or hop count), and the literal
 * `true` is rejected there so a misconfiguration cannot make every per-IP limit
 * bypassable by a forged header.
 *
 * Tuning now means editing the env vars or these defaults — never the guard or
 * the service.
 * ===============================================================
 */

/** Every window in this design is one minute; kept explicit for the maths. */
export const RATE_LIMIT_WINDOW_MS = 60_000;

export const RATE_LIMIT_DEFAULTS = {
  authIpPerMinute: 10,
  authIpBurst: 3,
  globalIpPerMinute: 120,
  globalIpBurst: 40,
  tenantPerMinute: 300,
  tenantBurst: 50,
} as const;

/**
 * Resolved limits, read once at construction.
 *
 * Env overrides exist so the thresholds can be tuned per environment (and so the
 * test suite can make them tiny or switch limiting off) without a code change.
 * The four public fields below are the guard's whole interface — the e2e suites
 * override them directly — so their names are stable regardless of how the
 * numbers are computed.
 */
@Injectable()
export class RateLimitConfig {
  readonly enabled: boolean;
  readonly authIpLimit: number;
  readonly globalIpLimit: number;
  readonly tenantLimit: number;

  constructor(config: ConfigService) {
    this.enabled = config.get<string>('RATE_LIMIT_ENABLED') !== 'false';

    this.authIpLimit = effectiveLimit(
      positive(config, 'RATE_LIMIT_AUTH_IP_PER_MINUTE', RATE_LIMIT_DEFAULTS.authIpPerMinute),
      nonNegative(config, 'RATE_LIMIT_AUTH_IP_BURST', RATE_LIMIT_DEFAULTS.authIpBurst),
    );
    this.globalIpLimit = effectiveLimit(
      positive(config, 'RATE_LIMIT_GLOBAL_IP_PER_MINUTE', RATE_LIMIT_DEFAULTS.globalIpPerMinute),
      nonNegative(config, 'RATE_LIMIT_GLOBAL_IP_BURST', RATE_LIMIT_DEFAULTS.globalIpBurst),
    );
    this.tenantLimit = effectiveLimit(
      positive(config, 'RATE_LIMIT_TENANT_PER_MINUTE', RATE_LIMIT_DEFAULTS.tenantPerMinute),
      nonNegative(config, 'RATE_LIMIT_TENANT_BURST', RATE_LIMIT_DEFAULTS.tenantBurst),
    );
  }
}

/** Sustained per-minute rate plus its additive burst allowance. */
function effectiveLimit(perMinute: number, burst: number): number {
  return Math.max(1, Math.ceil(perMinute + burst));
}

/** A per-minute rate: must be present-or-default and strictly positive. */
function positive(config: ConfigService, key: string, fallback: number): number {
  return parseEnvNumber(config, key, fallback, { allowZero: false });
}

/** A burst allowance: like {@link positive}, but zero is a valid "no burst". */
function nonNegative(config: ConfigService, key: string, fallback: number): number {
  return parseEnvNumber(config, key, fallback, { allowZero: true });
}

function parseEnvNumber(
  config: ConfigService,
  key: string,
  fallback: number,
  { allowZero }: { allowZero: boolean },
): number {
  const raw = config.get<string>(key);
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  const floor = allowZero ? 0 : Number.MIN_VALUE;
  if (!Number.isFinite(parsed) || parsed < floor) {
    throw new Error(
      `${key} must be a ${allowZero ? 'non-negative' : 'positive'} number ` +
        `when set; received "${raw}".`,
    );
  }
  return parsed;
}
