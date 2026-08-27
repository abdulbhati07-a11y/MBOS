import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PurchasesController } from './purchases.controller';
import { PurchasesService } from './purchases.service';

/**
 * Section 6.9 — purchase orders. Gated on `purchases`.
 *
 * `PurchasesService` is exported so a future consumer that needs the purchase
 * *workflow* — creating a PO, advancing its status — can inject it. Section
 * 6.11's supplier-spend report is deliberately not that consumer: it reads the
 * stored `PurchaseOrder.totalCents` directly, the same canonical figure `create`
 * persists, so it neither recomputes a total nor gains a truer one by routing
 * through here. Reporting is a read across the schema and lives in its own module.
 */
@Module({
  imports: [PrismaModule],
  controllers: [PurchasesController],
  providers: [PurchasesService],
  exports: [PurchasesService],
})
export class PurchasesModule {}
