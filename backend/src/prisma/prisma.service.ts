import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { tenantScopeExtension } from './tenant-scope.extension';

/**
 * Builds the tenant-scoped view of a client. Declared at module scope (rather
 * than inline in the constructor) so `ExtendedPrismaClient` below is a named,
 * portable type — an inline `$extends` result cannot be emitted in a .d.ts.
 */
function withTenantScope(
  base: PrismaClient,
  tenantContext: TenantContextService,
) {
  return base.$extends(tenantScopeExtension(tenantContext));
}

/** The client type consumers should depend on: every query is tenant-filtered. */
export type ExtendedPrismaClient = ReturnType<typeof withTenantScope>;

/**
 * Wraps the generated Prisma Client as an injectable Nest provider.
 *
 * Prisma v7 requires a driver adapter for SQL connections (no bundled query
 * engine), so we instantiate `PrismaPg` and hand it to the client. The
 * connection string comes from ConfigService, not a `url` in schema.prisma
 * (deprecated in v7 — see prisma.config.ts).
 *
 * Two access paths, deliberately:
 *   - `service.db`  — tenant-scoped. Use this in every feature module.
 *   - `service`     — raw, unscoped. Only for work that has no tenant yet
 *                     (signup, seeds, billing webhooks, health checks).
 *
 * The scoped client resolves tenantId per query from AsyncLocalStorage, so one
 * instance serves all requests — nothing is captured at construction time.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  /** Tenant-scoped client (Section 4.3). Default for all feature code. */
  readonly db: ExtendedPrismaClient;

  constructor(config: ConfigService, tenantContext: TenantContextService) {
    const connectionString = config.get<string>('DATABASE_URL');
    if (!connectionString) {
      throw new Error(
        'DATABASE_URL is not set. Copy backend/.env.example to backend/.env ' +
          'and set a PostgreSQL connection string before starting the server.',
      );
    }
    super({ adapter: new PrismaPg({ connectionString }) });
    this.db = withTenantScope(this, tenantContext);
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Connected to PostgreSQL via pg driver adapter');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
