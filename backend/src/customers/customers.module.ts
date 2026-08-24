import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

/** Section 6.6 — customers. Needs nothing but Prisma; access control is global. */
@Module({
  imports: [PrismaModule],
  controllers: [CustomersController],
  providers: [CustomersService],
})
export class CustomersModule {}
