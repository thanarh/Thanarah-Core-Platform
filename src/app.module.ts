import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { ConfigModule } from './config/config.module';
import { ConfigService } from './config/config.service';
import { DatabaseModule } from './database/database.module';
import { LoggerModule } from './common/logger/logger.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { RequestIdInterceptor } from './common/interceptors/request-id.interceptor';

const hasMongo = !!process.env['MONGO_URI'];

@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    ...(hasMongo ? [DatabaseModule] : []),
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
  ],
})
export class AppModule {}
