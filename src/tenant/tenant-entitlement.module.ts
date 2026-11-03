import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { TENANT_ENTITLEMENT_PERSISTENCE } from '../persistence/platform-persistence.ports';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { TenantEntitlementGuard } from './tenant-entitlement.guard';
import { TenantEntitlementRepository } from './tenant-entitlement.repository';
import { TenantEntitlementService } from './tenant-entitlement.service';

@Module({
  imports: [DatabaseModule, SubscriptionsModule],
  providers: [
    TenantEntitlementGuard,
    TenantEntitlementRepository,
    { provide: TENANT_ENTITLEMENT_PERSISTENCE, useExisting: TenantEntitlementRepository },
    TenantEntitlementService,
  ],
  exports: [TenantEntitlementGuard, TenantEntitlementService],
})
export class TenantEntitlementModule {}
