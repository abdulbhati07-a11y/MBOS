import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { TenancyModule } from './tenancy/tenancy.module';
import { TenantContextMiddleware } from './tenancy/tenant-context.middleware';

@Module({
  imports: [
    // Loads backend/.env and exposes ConfigService app-wide. Must resolve
    // before PrismaService, which reads DATABASE_URL from it.
    ConfigModule.forRoot({ isGlobal: true }),
    // Provides the per-request tenant context PrismaService reads to scope
    // queries, so it must be available before PrismaModule.
    TenancyModule,
    PrismaModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  /**
   * TenantContextMiddleware runs on every route — public ones included — so the
   * AsyncLocalStorage scope is always open before a guard or handler can reach
   * Prisma (Section 6.2, step 4).
   */
  configure(consumer: MiddlewareConsumer): void {
    // '{*path}' is the Express 5 / path-to-regexp v8 wildcard syntax; a bare
    // '*' is auto-converted with a deprecation warning.
    consumer.apply(TenantContextMiddleware).forRoutes('{*path}');
  }
}
