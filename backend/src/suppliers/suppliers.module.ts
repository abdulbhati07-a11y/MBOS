import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';

/** Section 6.6 — suppliers. Gated on `purchases`; see the controller. */
@Module({
  imports: [PrismaModule],
  controllers: [SuppliersController],
  providers: [SuppliersService],
})
export class SuppliersModule {}
