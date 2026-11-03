import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import {
  TENANT_MEMBERSHIP_ROLE_PERSISTENCE,
  TENANT_ROLE_PERSISTENCE,
} from '../persistence/platform-persistence.ports';
import { TenantMembershipRoleRepository } from './tenant-membership-role.repository';
import { TenantRoleRepository } from './tenant-role.repository';

@Module({
  imports: [DatabaseModule],
  providers: [
    TenantRoleRepository,
    TenantMembershipRoleRepository,
    { provide: TENANT_ROLE_PERSISTENCE, useExisting: TenantRoleRepository },
    {
      provide: TENANT_MEMBERSHIP_ROLE_PERSISTENCE,
      useExisting: TenantMembershipRoleRepository,
    },
  ],
  exports: [TENANT_ROLE_PERSISTENCE, TENANT_MEMBERSHIP_ROLE_PERSISTENCE],
})
export class TenantRolePersistenceModule {}
