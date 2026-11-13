import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { TENANT_ENTITLEMENT_PERSISTENCE } from '../persistence/platform-persistence.ports';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { TenantEntitlementGuard } from './tenant-entitlement.guard';
import { TenantEntitlementService } from './tenant-entitlement.service';
import { MongoTenantEntitlementRepository } from '../platform-mongo/mongo-tenant-entitlement.repository';

@Module({
  imports: [DatabaseModule, SubscriptionsModule],
  providers: [
    TenantEntitlementGuard,
    MongoTenantEntitlementRepository,
    { provide: TENANT_ENTITLEMENT_PERSISTENCE, useExisting: MongoTenantEntitlementRepository },
    TenantEntitlementService,
  ],
  exports: [TenantEntitlementGuard, TenantEntitlementService],
})
export class TenantEntitlementModule {}
