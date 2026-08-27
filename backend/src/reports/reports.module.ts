import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

/**
 * Section 6.11 — reports.
 *
 * Only `PrismaModule` is imported: the access-control guard that enforces
 * `reports.read` is registered globally by `AccessControlModule` in `AppModule`,
 * so like every other feature module this one carries only the `@RequiresPermission`
 * metadata and needs no import to be guarded.
 *
 * It deliberately does not import the feature modules whose tables it reads
 * (orders, products, customers, suppliers, purchases). A report is a read across
 * the schema, and it reads each table's already-computed canonical columns —
 * `Order.totalCents`, `PurchaseOrder.totalCents`, `RefundTransaction.amountCents` —
 * directly through the tenant-scoped client. Routing those reads back through the
 * owning services would not give a *truer* number (the number is the stored
 * column either way) and would couple the report layer to five write-path
 * services for nothing.
 */
@Module({
  imports: [PrismaModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
