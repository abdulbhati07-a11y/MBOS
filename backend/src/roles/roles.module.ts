import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

/**
 * Section 6.5 — roles and permission sets.
 *
 * Separate from AccessControlModule on purpose: that module supplies the guards
 * that *enforce* permissions on every request, while this one exposes the REST
 * surface that *administers* them. Keeping the enforcement path free of
 * controllers means a routing change can never alter how the chain is bound.
 */
@Module({
  imports: [PrismaModule],
  controllers: [RolesController],
  providers: [RolesService],
  exports: [RolesService],
})
export class RolesModule {}
