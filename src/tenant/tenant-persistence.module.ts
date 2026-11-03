import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import {
  TENANT_MEMBERSHIP_PERSISTENCE,
  TENANT_PERSISTENCE,
} from '../persistence/platform-persistence.ports';
import { TenantMembershipRepository } from './tenant-membership.repository';
import { TenantRepository } from './tenant.repository';

@Module({
  imports: [DatabaseModule],
  providers: [
    TenantRepository,
    TenantMembershipRepository,
    { provide: TENANT_PERSISTENCE, useExisting: TenantRepository },
    { provide: TENANT_MEMBERSHIP_PERSISTENCE, useExisting: TenantMembershipRepository },
  ],
  exports: [TENANT_PERSISTENCE, TENANT_MEMBERSHIP_PERSISTENCE],
})
export class TenantPersistenceModule {}
