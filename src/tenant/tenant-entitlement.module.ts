import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { TenantEntitlementGuard } from './tenant-entitlement.guard';
import { TenantEntitlementRepository } from './tenant-entitlement.repository';
import { TenantEntitlementService } from './tenant-entitlement.service';

@Module({
  imports: [DatabaseModule, SubscriptionsModule],
  providers: [TenantEntitlementGuard, TenantEntitlementRepository, TenantEntitlementService],
  exports: [TenantEntitlementGuard, TenantEntitlementService],
})
export class TenantEntitlementModule {}
