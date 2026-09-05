import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

/**
 * Section 6.7 — orders. Gated on `sales`; refunds need `sales.refund`.
 *
 * `OrdersService` is exported because Section 6.9's reports aggregate order
 * totals, and duplicating that arithmetic there would give the money path a
 * second place to live.
 */
@Module({
  imports: [PrismaModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
