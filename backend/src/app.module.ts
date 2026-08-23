import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AccessControlModule } from './access-control/access-control.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { MailModule } from './mail/mail.module';
import { PrismaModule } from './prisma/prisma.module';
import { RateLimitModule } from './rate-limit/rate-limit.module';
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
    // Binds MAIL_PROVIDER to the no-op ConsoleMailProvider until a transport is
    // chosen (DEBT-015). @Global, so no feature module needs to import it to
    // inject the token. No wired consumers yet — the stub exists so password
    // reset can be built the moment a provider is selected.
    MailModule,
    // Chain steps 2, 5 and 6. Imported here as well as by AuthModule so the
    // rate limiter and access-control guards are singletons shared by every
    // feature module, not re-instantiated per importer — the rate limiter's
    // counters are in-process state and must not be duplicated.
    RateLimitModule,
    AccessControlModule,
    AuthModule,
    // Section 6.10 — the write side of the module gating that step 5 enforces
    // on read. Imported after AuthModule so the global guard is registered
    // before these controllers' routes are mapped.
    BillingModule,
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
