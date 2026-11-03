import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { PlatformSecurityModule } from '../platform-security/platform-security.module';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionPersistenceModule } from './subscription-persistence.module';
import { SubscriptionService } from './subscription.service';

@Module({
  imports: [AuthModule, DatabaseModule, PlatformSecurityModule, SubscriptionPersistenceModule],
  controllers: [SubscriptionController],
  providers: [SubscriptionService],
  exports: [SubscriptionService],
})
export class SubscriptionsModule {}
