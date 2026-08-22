import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { TokenService } from './token.service';

/**
 * Steps 3 and 4 of the middleware chain (Section 6.2), as one guard.
 *
 * Validates the bearer token, then binds {tenantId, userId, role} into
 * AsyncLocalStorage for the rest of the request so the Prisma tenant-scope
 * extension can filter every query. The two steps are inseparable in practice:
 * a request that passed authentication but skipped context binding would hit
 * the extension's fail-closed branch anyway.
 *
 * Registered globally in AuthModule, so a route is protected unless it opts out
 * with @Public().
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const claims = await this.tokens.verifyAccessToken(token);

    // The scope itself was opened by TenantContextMiddleware; this fills it.
    this.tenantContext.set({
      tenantId: claims.tenantId,
      userId: claims.sub,
      role: claims.roleName,
    });

    return true;
  }
}

function extractBearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !value) return undefined;
  return value.trim();
}
