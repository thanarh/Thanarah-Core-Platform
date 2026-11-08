import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConfigModule } from '../config/config.module';
import { ConfigService } from '../config/config.service';
import { TenantModule } from '../tenant/tenant.module';
import { effectiveTenantStorageProvider } from '../tenant/tenant-storage.mode';
import { COMMUNICATIONS_STORAGE, COMMUNICATIONS_WEBHOOK_ADAPTER } from './communications.types';
import type { CommunicationStorage } from './communications.types';
import {
  CommunicationsController,
  CommunicationsWebhookController,
} from './communications.controller';
import {
  InMemoryCommunicationsStorage,
  MongoCommunicationsStorage,
  UnconfiguredCommunicationsStorage,
} from './communications.storage';
import {
  CommunicationsService,
  UnconfiguredCommunicationWebhookAdapter,
} from './communications.service';

@Module({
  imports: [AuthModule, ConfigModule, TenantModule],
  controllers: [CommunicationsController, CommunicationsWebhookController],
  providers: [
    MongoCommunicationsStorage,
    InMemoryCommunicationsStorage,
    UnconfiguredCommunicationsStorage,
    {
      provide: COMMUNICATIONS_STORAGE,
      inject: [
        ConfigService,
        MongoCommunicationsStorage,
        InMemoryCommunicationsStorage,
        UnconfiguredCommunicationsStorage,
      ],
      useFactory: (
        config: ConfigService,
        persistent: MongoCommunicationsStorage,
        memory: InMemoryCommunicationsStorage,
        unconfigured: UnconfiguredCommunicationsStorage,
      ): CommunicationStorage => {
        const provider = effectiveTenantStorageProvider(
          config.tenantStorageProvider,
          config.isDevelopment,
        );
        if (provider === 'mongodb') return persistent;
        if (provider === 'memory') return memory;
        return unconfigured;
      },
    },
    UnconfiguredCommunicationWebhookAdapter,
    {
      provide: COMMUNICATIONS_WEBHOOK_ADAPTER,
      useExisting: UnconfiguredCommunicationWebhookAdapter,
    },
    CommunicationsService,
  ],
})
export class CommunicationsModule {}
