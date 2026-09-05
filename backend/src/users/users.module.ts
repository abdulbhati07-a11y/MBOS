import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * Section 6.5 — user management.
 *
 * AuthModule is imported for PasswordService: a created user's password is hashed
 * with the same work factor and implementation that login verifies against, so
 * there is exactly one place bcrypt is configured.
 */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
