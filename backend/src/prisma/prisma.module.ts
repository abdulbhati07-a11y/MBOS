import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { SchemaVersionService } from './schema-version.service';

/**
 * Global so every feature module can inject PrismaService without re-importing.
 * There is exactly one Prisma connection pool for the whole process.
 *
 * `SchemaVersionService` is not exported — nothing injects it. It exists to run
 * its `onApplicationBootstrap` hook, which refuses to finish booting against a
 * database whose schema is older than this build (DEBT-041). It lives here
 * because it needs the verified pg connection and nothing else.
 */
@Global()
@Module({
  providers: [PrismaService, SchemaVersionService],
  exports: [PrismaService],
})
export class PrismaModule {}
