import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SUBSCRIPTION_PERSISTENCE } from '../persistence/platform-persistence.ports';
import { MongoSubscriptionRepository } from '../platform-mongo/mongo-subscription.repository';

@Module({
  imports: [DatabaseModule],
  providers: [
    MongoSubscriptionRepository,
    { provide: SUBSCRIPTION_PERSISTENCE, useExisting: MongoSubscriptionRepository },
  ],
  exports: [SUBSCRIPTION_PERSISTENCE],
})
export class SubscriptionPersistenceModule {}
