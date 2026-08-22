import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ModuleAccessGuard } from './module-access.guard';
import { PermissionGuard } from './permission.guard';

/**
 * Chain steps 5 and 6 (Section 6.2). Both guards are exported for ApiAccessGuard
 * to invoke in order; neither is registered as a global guard itself, because
 * their ordering relative to authentication is a security property and is
 * therefore made explicit in ApiAccessGuard rather than left to the order in
 * which Nest happens to resolve APP_GUARD providers.
 */
@Module({
  imports: [PrismaModule],
  providers: [ModuleAccessGuard, PermissionGuard],
  exports: [ModuleAccessGuard, PermissionGuard],
})
export class AccessControlModule {}
