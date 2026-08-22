import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { TenantContextService } from './tenant-context.service';

/**
 * Opens the AsyncLocalStorage scope that the auth guard later fills (step 4 of
 * the chain in Section 6.2). Applied to every route, including public ones, so
 * that no code path can reach Prisma without a scope in place.
 */
@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  constructor(private readonly tenantContext: TenantContextService) {}

  use(_req: Request, _res: Response, next: NextFunction): void {
    this.tenantContext.runWithEmptyContext(() => next());
  }
}
