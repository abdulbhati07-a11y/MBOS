import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { PlansController } from './plans.controller';

/**
 * Section 6.10. Registers no guards of its own: the global ApiAccessGuard runs
 * the whole Section 6.2 chain, and these controllers declare their requirements
 * with @RequiresPermission.
 */
@Module({
  imports: [PrismaModule],
  controllers: [BillingController, PlansController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
