import { Prisma } from '../generated/prisma/client';
import type { TenantContextService } from '../tenancy/tenant-context.service';

/**
 * Row-level tenant isolation (Section 4.3).
 *
 * Every query against a tenant-scoped model is rewritten to carry the current
 * request's tenantId — read filters get it in `where`, writes get it in `data`.
 * The value comes from AsyncLocalStorage, which is populated from validated JWT
 * claims only, so a caller cannot forge it through a body or query param.
 *
 * Prisma v7 removed `$use` middleware, so this is a client extension instead.
 * It hooks `$allOperations` on `$allModels` and dispatches per operation.
 */

/**
 * Models carrying a `tenantId` column that must be scoped automatically.
 *
 * Deliberately excluded:
 *   - `Tenant`            — the isolation root; scoped by `id`, not `tenantId`
 *   - `RefreshToken`      — keyed by userId; auth reads it before context exists
 *   - `Role`              — nullable tenantId (null = global built-in), so an
 *                           injected filter would hide the built-ins
 *   - `RolePermission`    — reached only through Role
 *   - `Plan`, `PlanModule`— global catalog, not tenant data
 *   - `OrderLine`,`POLine`— no tenantId; isolated via their parent's scoped FK
 */
const SCOPED_MODELS: ReadonlySet<string> = new Set([
  'TenantSettings',
  'Branch',
  'User',
  'TenantModuleSubscription',
  'TenantSubscription',
  'Customer',
  'Supplier',
  'Product',
  'Order',
  'RefundTransaction',
  'PurchaseOrder',
  'POStatusTransition',
  'StockAdjustment',
]);

/**
 * Operations whose `where` must be narrowed to the tenant.
 *
 * `findUnique`/`findUniqueOrThrow` are included: since Prisma 4.5
 * `WhereUniqueInput` accepts additional non-unique scalar filters alongside the
 * unique constraint, so an injected `tenantId` narrows the lookup rather than
 * failing validation. That turns a cross-tenant id guess into a null result.
 */
const WHERE_OPERATIONS: ReadonlySet<string> = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'updateMany',
  'updateManyAndReturn',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'delete',
]);

/** Operations that write new rows and therefore need tenantId in `data`. */
const CREATE_OPERATIONS: ReadonlySet<string> = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
]);

type LooseArgs = Record<string, unknown>;

function scopeWhere(args: LooseArgs, tenantId: string): void {
  args.where = { ...(args.where ?? {}), tenantId };
}

function scopeData(args: LooseArgs, tenantId: string): void {
  const data = args.data;
  args.data = Array.isArray(data)
    ? data.map((row: LooseArgs) => ({ ...row, tenantId }))
    : { ...(data ?? {}), tenantId };
}

export const tenantScopeExtension = (tenantContext: TenantContextService) =>
  Prisma.defineExtension({
    name: 'tenant-scope',
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          if (!SCOPED_MODELS.has(model)) {
            return query(args);
          }

          const tenantId = tenantContext.getTenantId();
          if (!tenantId) {
            // No request context: startup checks, seeds, or a route that
            // reached the DB before authentication. Failing closed is the only
            // safe default — a silent unscoped query would leak across tenants.
            throw new Error(
              `Tenant context missing for ${model}.${operation}. ` +
                'Tenant-scoped models can only be queried inside an ' +
                'authenticated request. For system-level work (seeds, ' +
                'signup, billing webhooks) use the unscoped client — ' +
                'PrismaService itself — instead of PrismaService.db.',
            );
          }

          const next: LooseArgs = args;

          if (WHERE_OPERATIONS.has(operation)) {
            scopeWhere(next, tenantId);
            return query(args);
          }

          if (CREATE_OPERATIONS.has(operation)) {
            scopeData(next, tenantId);
            return query(args);
          }

          if (operation === 'upsert') {
            scopeWhere(next, tenantId);
            next.create = { ...(next.create ?? {}), tenantId };
            return query(args);
          }

          // Unrecognized operation (a future Prisma addition). Fail closed
          // rather than let it through unscoped.
          throw new Error(
            `Operation ${model}.${operation} is not covered by the tenant ` +
              'scope extension. Add it to tenant-scope.extension.ts before use.',
          );
        },
      },
    },
  });
