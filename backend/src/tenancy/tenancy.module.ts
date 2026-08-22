import { Global, Module } from '@nestjs/common';
import { TenantContextMiddleware } from './tenant-context.middleware';
import { TenantContextService } from './tenant-context.service';

/**
 * Global so the auth layer (which populates the context) and PrismaService
 * (which reads it to scope every query) share one AsyncLocalStorage instance.
 */
@Global()
@Module({
  providers: [TenantContextService, TenantContextMiddleware],
  exports: [TenantContextService, TenantContextMiddleware],
})
export class TenancyModule {}
