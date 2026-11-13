import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import {
  TENANT_MEMBERSHIP_ROLE_PERSISTENCE,
  TENANT_ROLE_PERSISTENCE,
} from '../persistence/platform-persistence.ports';
import { MongoTenantRoleRepository } from '../platform-mongo/mongo-tenant-role.repository';
import { MongoTenantMembershipRoleRepository } from '../platform-mongo/mongo-tenant-membership-role.repository';

@Module({
  imports: [DatabaseModule],
  providers: [
    MongoTenantRoleRepository,
    MongoTenantMembershipRoleRepository,
    { provide: TENANT_ROLE_PERSISTENCE, useExisting: MongoTenantRoleRepository },
    {
      provide: TENANT_MEMBERSHIP_ROLE_PERSISTENCE,
      useExisting: MongoTenantMembershipRoleRepository,
    },
  ],
  exports: [TENANT_ROLE_PERSISTENCE, TENANT_MEMBERSHIP_ROLE_PERSISTENCE],
})
export class TenantRolePersistenceModule {}
