import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { TenantEntitlementModule } from './tenant-entitlement.module';
import { TenantQuotaRepository } from './tenant-quota.repository';
import { TenantQuotaService } from './tenant-quota.service';

@Module({
  imports: [DatabaseModule, TenantEntitlementModule],
  providers: [TenantQuotaRepository, TenantQuotaService],
  exports: [TenantQuotaService],
})
export class TenantQuotaModule {}
