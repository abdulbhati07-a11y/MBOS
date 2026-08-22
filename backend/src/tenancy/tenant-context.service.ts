import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request tenant context (Section 4.3).
 *
 * Populated once, immediately after JWT validation, from the token claims —
 * never from request body or query params (that would let a caller forge a
 * tenantId). Everything downstream in the request (including the Prisma
 * tenant-scoping extension) reads it from here instead of threading it through
 * every function signature.
 */
export interface TenantContext {
  tenantId: string;
  userId: string;
  /**
   * The role's primary key — what the permission guard (chain step 6) looks
   * RolePermission rows up by. Required, not optional: authorization must never
   * silently fall back to "no roleId, so skip the check", and making the
   * compiler demand it at every construction site is what guarantees that.
   */
  roleId: string;
  role: string;
}

/**
 * A mutable box, not the context itself, is what lives in AsyncLocalStorage.
 *
 * The reason is ordering: `AsyncLocalStorage.run` needs a callback to wrap, and
 * only Express middleware gets one (`next`) — but at middleware time the JWT has
 * not been validated yet, so there are no claims to store. The middleware
 * therefore opens an empty box around the request and the auth guard fills it in
 * once the token checks out. The alternative, `enterWith` from inside the guard,
 * mutates the ambient store with no defined end and is documented as a footgun.
 */
interface ContextHolder {
  context?: TenantContext;
}

@Injectable()
export class TenantContextService {
  private readonly als = new AsyncLocalStorage<ContextHolder>();

  /**
   * Opens an empty context scope for one request. Called by
   * TenantContextMiddleware, which runs before any guard.
   */
  runWithEmptyContext<T>(callback: () => T): T {
    return this.als.run({}, callback);
  }

  /** Fills the open scope after JWT validation. */
  set(context: TenantContext): void {
    const holder = this.als.getStore();
    if (!holder) {
      throw new Error(
        'No tenant context scope is open. TenantContextMiddleware must run ' +
          'before the auth guard.',
      );
    }
    holder.context = context;
  }

  /**
   * Runs `callback` with `context` bound for the duration of its async chain.
   * Used outside the HTTP path — tests, seeds, and background jobs.
   *
   * The callback's result is awaited *inside* the storage scope on purpose.
   * Prisma promises are lazy — their `then` is what actually issues the query —
   * so returning one out of `AsyncLocalStorage.run` unawaited would execute it
   * after the scope had already exited, and the tenant-scoping extension would
   * see no context.
   */
  async run<T>(
    context: TenantContext,
    callback: () => T | Promise<T>,
  ): Promise<T> {
    return this.als.run({ context }, async () => await callback());
  }

  /** The full context, or undefined outside a request (e.g. startup, seeds). */
  get(): TenantContext | undefined {
    return this.als.getStore()?.context;
  }

  /** The current tenantId, or undefined when no request context is bound. */
  getTenantId(): string | undefined {
    return this.get()?.tenantId;
  }
}
