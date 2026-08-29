import { Module } from '@nestjs/common';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AutomationRulesModule } from './automation/automation-rules.module';
import { BillingModule } from './billing/billing.module';
import { BrandsModule } from './brands/brands.module';
import { CategoriesModule } from './categories/categories.module';
import { CustomersModule } from './customers/customers.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { FinanceModule } from './finance/finance.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { SubscriptionGuard } from './common/guards/subscription.guard';
import { TenantContextInterceptor } from './common/interceptors/tenant-context.interceptor';
import { appConfig } from './config/app.config';
import { databaseConfig } from './config/database.config';
import { validateEnv } from './config/env.validation';
import { jwtConfig } from './config/jwt.config';
import { platformAdminConfig } from './config/platform-admin.config';
import { stripeConfig } from './config/stripe.config';
import { HealthModule } from './health/health.module';
import { LocationsModule } from './locations/locations.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OrdersModule } from './orders/orders.module';
import { PlatformAdminModule } from './platform-admin/platform-admin.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProductsModule } from './products/products.module';
import { ProductUnitsModule } from './product-units/product-units.module';
import { PurchaseOrdersModule } from './purchase-orders/purchase-orders.module';
import { RepairsModule } from './repairs/repairs.module';
import { ReportsModule } from './reports/reports.module';
import { ReturnsModule } from './returns/returns.module';
import { SettingsModule } from './settings/settings.module';
import { StockModule } from './stock/stock.module';
import { StockCountsModule } from './stock-counts/stock-counts.module';
import { StockTransfersModule } from './stock-transfers/stock-transfers.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      expandVariables: true,
      // Resolved against the process working directory: the first entry covers
      // running from the app folder, the second the monorepo root .env.
      envFilePath: ['.env', '../../.env'],
      load: [appConfig, databaseConfig, jwtConfig, stripeConfig, platformAdminConfig],
      validate: validateEnv,
    }),
    ThrottlerModule.forRootAsync({
      inject: [appConfig.KEY],
      useFactory: (config: ConfigType<typeof appConfig>) => ({
        throttlers: [{ ttl: config.throttle.ttlMs, limit: config.throttle.limit }],
      }),
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuditModule,
    AuthModule,
    BillingModule,
    PlatformAdminModule,
    UsersModule,
    CustomersModule,
    SuppliersModule,
    CategoriesModule,
    BrandsModule,
    ProductsModule,
    ProductUnitsModule,
    LocationsModule,
    StockModule,
    OrdersModule,
    PurchaseOrdersModule,
    StockTransfersModule,
    StockCountsModule,
    RepairsModule,
    ReturnsModule,
    FinanceModule,
    NotificationsModule,
    AutomationRulesModule,
    DashboardModule,
    ReportsModule,
    SettingsModule,
    HealthModule,
  ],
  providers: [
    // Order matters: rate limiting rejects floods before any work is done,
    // then authentication establishes who the caller is, then authorisation
    // decides what they may do.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // Billing gate, last: a caller who is authenticated and permitted the
    // route can still be refused if their organization's trial or
    // subscription has lapsed.
    { provide: APP_GUARD, useClass: SubscriptionGuard },
    // Interceptors run after guards, wrapping the handler call itself - the tenant
    // context has to be established here, not in JwtAuthGuard, so it survives into
    // the controller/service call. See TenantContextInterceptor's own comment.
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
})
export class AppModule {}
