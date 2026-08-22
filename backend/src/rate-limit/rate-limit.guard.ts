import { ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { RateLimitConfig } from './rate-limit.config';
import { STRICT_RATE_LIMIT_KEY } from './rate-limit.decorator';
import { RateLimitService } from './rate-limit.service';

/** Section 6.1's 429 body, minus the `code` the error filter supplies. */
const TOO_MANY_REQUESTS_MESSAGE =
  'Too many requests. Please retry after the indicated time.';

/**
 * Step 2 of the middleware chain (Section 6.2), in two halves.
 *
 * Section 6.2 numbers rate limiting before authentication, while Section 6.1
 * also asks for a per-tenant limit keyed on the JWT's `tenantId` — which does
 * not exist until step 3 has run. Those two requirements cannot both be met by a
 * single check, so this guard exposes two:
 *
 *   checkIp     — runs before authentication for every request, public included.
 *   checkTenant — runs immediately after authentication, once tenantId is bound.
 *
 * The security intent of "before auth" is preserved: an unauthenticated flood is
 * rejected by checkIp before any bcrypt comparison or database round trip. See
 * DEBT-017.
 */
@Injectable()
export class RateLimitGuard {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimitService,
    private readonly config: RateLimitConfig,
    private readonly tenantContext: TenantContextService,
  ) {}

  /** Per-IP limit. Stricter on routes carrying @StrictRateLimit(). */
  checkIp(context: ExecutionContext): void {
    if (!this.config.enabled) return;

    const strict =
      this.reflector.getAllAndOverride<boolean>(STRICT_RATE_LIMIT_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false;

    const request = context.switchToHttp().getRequest<Request>();
    const ip = clientIp(request);

    // Separate keyspaces: a burst of logins must not consume the allowance for
    // ordinary traffic from the same address, and vice versa.
    this.enforce(
      strict ? `auth-ip:${ip}` : `ip:${ip}`,
      strict ? this.config.authIpLimit : this.config.globalIpLimit,
    );
  }

  /**
   * Per-tenant limit. Called only after the auth guard has bound the request
   * context; a missing context means this ran out of order, so it is a
   * programming error rather than something to silently skip.
   */
  checkTenant(): void {
    if (!this.config.enabled) return;

    const tenantId = this.tenantContext.getTenantId();
    if (!tenantId) {
      throw new Error(
        'RateLimitGuard.checkTenant ran before the tenant context was bound. ' +
          'It must be invoked after the auth guard (chain steps 3-4).',
      );
    }

    this.enforce(`tenant:${tenantId}`, this.config.tenantLimit);
  }

  private enforce(key: string, limit: number): void {
    const decision = this.limiter.consume(key, limit);
    if (decision.allowed) return;

    // `retryAfter` rides in the payload; ApiExceptionFilter lifts it into
    // `error.retryAfter` and onto the Retry-After header (Section 6.1).
    throw new HttpException(
      {
        message: TOO_MANY_REQUESTS_MESSAGE,
        retryAfter: decision.retryAfterSeconds,
      },
      429,
    );
  }
}

/**
 * The address the limit is keyed on.
 *
 * OPERATIONAL NOTE: `req.ip` is the socket address unless Express is configured
 * with `trust proxy`. Behind a load balancer without it, every request appears to
 * come from the balancer and one noisy client would throttle all tenants at once;
 * with it set too permissively, a client can forge X-Forwarded-For and evade the
 * limit entirely. Neither failure is acceptable, and Sections 4-6 do not specify
 * the deployment topology — recorded in DEBT-013 alongside the thresholds.
 */
function clientIp(request: Request): string {
  return request.ip ?? request.socket.remoteAddress ?? 'unknown';
}
