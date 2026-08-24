import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

/** Section 6.6 — products. Gated on `inventory`; `stock` is not writable here. */
@Module({
  imports: [PrismaModule],
  controllers: [ProductsController],
  providers: [ProductsService],
})
export class ProductsModule {}
