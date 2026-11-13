import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { TENANT_QUOTA_PERSISTENCE } from '../persistence/platform-persistence.ports';
import { TenantEntitlementModule } from './tenant-entitlement.module';
import { TenantQuotaService } from './tenant-quota.service';
import { MongoTenantEntitlementRepository } from '../platform-mongo/mongo-tenant-entitlement.repository';

@Module({
  imports: [DatabaseModule, TenantEntitlementModule],
  providers: [
    MongoTenantEntitlementRepository,
    { provide: TENANT_QUOTA_PERSISTENCE, useExisting: MongoTenantEntitlementRepository },
    TenantQuotaService,
  ],
  exports: [TenantQuotaService],
})
export class TenantQuotaModule {}
