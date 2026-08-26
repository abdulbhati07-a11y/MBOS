import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PurchasesController } from './purchases.controller';
import { PurchasesService } from './purchases.service';

/**
 * Section 6.9 — purchase orders. Gated on `purchases`.
 *
 * `PurchasesService` is exported because Section 6.11's supplier-spend report
 * aggregates PO totals, and re-deriving them there would give the purchase
 * ledger a second definition of what a tenant spent.
 */
@Module({
  imports: [PrismaModule],
  controllers: [PurchasesController],
  providers: [PurchasesService],
  exports: [PurchasesService],
})
export class PurchasesModule {}
