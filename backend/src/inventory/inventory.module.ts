import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

/**
 * Section 6.8 — inventory adjustments and stock alerts. Gated on `inventory`.
 *
 * `InventoryService` is exported because Section 6.9 receives purchase orders,
 * which moves stock and must leave the same audit trail — writing that increment
 * separately would give `Product.stock` a third writer with its own idea of what
 * an adjustment row looks like.
 */
@Module({
  imports: [PrismaModule],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
