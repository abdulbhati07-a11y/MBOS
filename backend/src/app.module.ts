import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AccessControlModule } from './access-control/access-control.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { CustomersModule } from './customers/customers.module';
import { InventoryModule } from './inventory/inventory.module';
import { MailModule } from './mail/mail.module';
import { OrdersModule } from './orders/orders.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProductsModule } from './products/products.module';
import { RateLimitModule } from './rate-limit/rate-limit.module';
import { RolesModule } from './roles/roles.module';
import { SettingsModule } from './settings/settings.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { TenancyModule } from './tenancy/tenancy.module';
import { TenantContextMiddleware } from './tenancy/tenant-context.middleware';
import { UsersModule } from './users/users.module';

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
    // Section 6.4 — settings and branches. Like BillingModule, imported after
    // AuthModule so the global access guard is registered before these routes
    // are mapped. Settings is the first module every session reads (the POS
    // needs the tenant's tax rate before it can total an order — DEBT-008).
    SettingsModule,
    // Section 6.5 — role and permission administration. Distinct from
    // AccessControlModule, which enforces permissions; this exposes the REST
    // surface that manages them (DEBT-006, DEBT-007).
    RolesModule,
    // Section 6.5 — user management. Imports AuthModule for PasswordService, so
    // a created user's password is hashed by the same code login verifies with.
    UsersModule,
    // Section 6.6 — the core business entities. Sections 6.7-6.9 build orders,
    // adjustments and POs on top, which is why Product.stock is read-only here
    // and only audited writers change it.
    CustomersModule,
    SuppliersModule,
    ProductsModule,
    // Section 6.7 — orders. The first module that writes money, so it is also
    // the first that has to compute it: totals are derived server-side from the
    // lines (BR-05), prices are snapshotted at sale time, and completing an
    // order decrements stock in the same transaction (BR-02, FR-SALE-04) —
    // making this the second writer of Product.stock after 6.8's adjustments.
    OrdersModule,
    // Section 6.8 — the audited write path for Product.stock. Registered after
    // OrdersModule because order completion is the other writer, and the two must
    // agree on the shape of a StockAdjustment row for the audit log to reconcile
    // (BR-02). Also owns the alerts the Dashboard's Inventory Health widget reads.
    InventoryModule,
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
