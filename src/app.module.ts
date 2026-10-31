import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { ConfigModule } from './config/config.module';
import { ConfigService } from './config/config.service';
import { DatabaseModule } from './database/database.module';
import { LoggerModule } from './common/logger/logger.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { RequestIdInterceptor } from './common/interceptors/request-id.interceptor';
import { AuthModule } from './auth/auth.module';
import { PlatformSecurityModule } from './platform-security/platform-security.module';
import { TenantModule } from './tenant/tenant.module';
import { PlatformCatalogModule } from './platform-catalog/platform-catalog.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { PlatformMongoModule } from './platform-mongo/platform-mongo.module';

@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    DatabaseModule,
    PlatformMongoModule,
    PlatformSecurityModule,
    AuthModule,
    TenantModule,
    PlatformCatalogModule,
    SubscriptionsModule,
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            ttl: config.throttleTtl,
            limit: config.throttleLimit,
          },
        ],
      }),
    }),
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: RequestIdInterceptor },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
