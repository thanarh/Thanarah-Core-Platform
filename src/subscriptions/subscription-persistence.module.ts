import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SUBSCRIPTION_PERSISTENCE } from '../persistence/platform-persistence.ports';
import { SubscriptionRepository } from './subscription.repository';

@Module({
  imports: [DatabaseModule],
  providers: [
    SubscriptionRepository,
    { provide: SUBSCRIPTION_PERSISTENCE, useExisting: SubscriptionRepository },
  ],
  exports: [SUBSCRIPTION_PERSISTENCE],
})
export class SubscriptionPersistenceModule {}
