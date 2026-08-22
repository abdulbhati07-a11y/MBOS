import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { RATE_LIMIT_WINDOW_MS } from './rate-limit.config';

/** How often expired buckets are swept out of the map. */
const SWEEP_INTERVAL_MS = 60_000;

export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds until the caller may retry. Only meaningful when denied. */
  retryAfterSeconds: number;
}

/**
 * Sliding-window request counter (Section 6.1, chain step 2).
 *
 * Each key keeps the timestamps of its recent requests; anything older than the
 * window is dropped on read. A sliding window is used rather than a fixed
 * calendar-minute bucket because a fixed bucket lets a caller send `limit`
 * requests at 11:59:59 and `limit` again at 12:00:00 — double the intended rate
 * across the boundary, which is exactly the burst a login limiter must stop.
 *
 * State is per-process and in memory. That is correct for a single instance and
 * is a KNOWN LIMITATION once the API is scaled horizontally: N replicas would
 * each allow the full limit. Moving to a shared store (Redis) is the fix, and it
 * is confined to this class — `consume` is the only surface the guard depends on.
 *
 * Deliberately dependency-free: see the plan's rationale. Swapping in a library
 * later means reimplementing `consume`, nothing else.
 */
@Injectable()
export class RateLimitService implements OnModuleDestroy {
  /** key -> ascending timestamps of requests still inside the window. */
  private readonly hits = new Map<string, number[]>();
  private readonly sweepTimer: NodeJS.Timeout;

  constructor() {
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    // Without unref a pending interval keeps the event loop alive, which would
    // hang `nest start` on shutdown and leave Jest waiting on an open handle.
    this.sweepTimer.unref();
  }

  /**
   * Records one request against `key` and reports whether it is allowed.
   *
   * A denied request is NOT recorded. Counting rejections would let a caller who
   * is already over the limit keep pushing their own window forward, extending
   * the lockout indefinitely — the limiter would punish persistence rather than
   * simply shedding load.
   */
  consume(
    key: string,
    limit: number,
    windowMs: number = RATE_LIMIT_WINDOW_MS,
  ): RateLimitDecision {
    const now = Date.now();
    const cutoff = now - windowMs;

    const recent = (this.hits.get(key) ?? []).filter(
      (timestamp) => timestamp > cutoff,
    );

    if (recent.length >= limit) {
      this.hits.set(key, recent);
      // The window frees a slot when its oldest hit falls out of it.
      const oldest = recent[0];
      const retryAfterMs = oldest + windowMs - now;
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
      };
    }

    recent.push(now);
    this.hits.set(key, recent);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  /** Drops all counters. Used between test cases; never in request handling. */
  reset(): void {
    this.hits.clear();
  }

  onModuleDestroy(): void {
    clearInterval(this.sweepTimer);
  }

  /**
   * Removes keys with no hits left inside the window, so an API that has seen
   * many distinct IPs does not retain a map entry for each one forever.
   */
  private sweep(): void {
    const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
    for (const [key, timestamps] of this.hits) {
      const recent = timestamps.filter((timestamp) => timestamp > cutoff);
      if (recent.length === 0) {
        this.hits.delete(key);
      } else {
        this.hits.set(key, recent);
      }
    }
  }
}
