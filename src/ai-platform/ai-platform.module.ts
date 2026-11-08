import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConfigModule } from '../config/config.module';
import { ConfigService } from '../config/config.service';
import { TenantModule } from '../tenant/tenant.module';
import { effectiveTenantStorageProvider } from '../tenant/tenant-storage.mode';
import { AI_INFERENCE_RUNTIME, AI_TENANT_STORE } from './ai-platform.types';
import type { AiTenantStore } from './ai-platform.types';
import { AiPlatformController } from './ai-platform.controller';
import {
  InMemoryAiTenantStore,
  MongoAiTenantStore,
  UnconfiguredAiTenantStore,
} from './ai-tenant-store';
import { AiRuntimeClient } from './ai-runtime.client';
import { AiPlatformService } from './ai-platform.service';

@Module({
  imports: [AuthModule, ConfigModule, TenantModule],
  controllers: [AiPlatformController],
  providers: [
    MongoAiTenantStore,
    InMemoryAiTenantStore,
    UnconfiguredAiTenantStore,
    {
      provide: AI_TENANT_STORE,
      inject: [ConfigService, MongoAiTenantStore, InMemoryAiTenantStore, UnconfiguredAiTenantStore],
      useFactory: (
        config: ConfigService,
        mongo: MongoAiTenantStore,
        memory: InMemoryAiTenantStore,
        unconfigured: UnconfiguredAiTenantStore,
      ): AiTenantStore => {
        const provider = effectiveTenantStorageProvider(
          config.tenantStorageProvider,
          config.isDevelopment,
        );
        if (provider === 'mongodb') return mongo;
        if (provider === 'memory') return memory;
        return unconfigured;
      },
    },
    AiRuntimeClient,
    { provide: AI_INFERENCE_RUNTIME, useExisting: AiRuntimeClient },
    AiPlatformService,
  ],
})
export class AiPlatformModule {}
