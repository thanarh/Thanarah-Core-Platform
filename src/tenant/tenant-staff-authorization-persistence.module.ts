import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import {
  TENANT_STAFF_ROLE_PERSISTENCE,
  TENANT_STAFF_SCOPE_PERSISTENCE,
} from '../persistence/platform-persistence.ports';
import { MongoTenantStaffRoleRepository } from '../platform-mongo/mongo-tenant-staff-role.repository';
import { MongoTenantStaffScopeRepository } from '../platform-mongo/mongo-tenant-staff-scope.repository';

@Module({
  imports: [DatabaseModule],
  providers: [
    MongoTenantStaffRoleRepository,
    MongoTenantStaffScopeRepository,
    { provide: TENANT_STAFF_ROLE_PERSISTENCE, useExisting: MongoTenantStaffRoleRepository },
    { provide: TENANT_STAFF_SCOPE_PERSISTENCE, useExisting: MongoTenantStaffScopeRepository },
  ],
  exports: [TENANT_STAFF_ROLE_PERSISTENCE, TENANT_STAFF_SCOPE_PERSISTENCE],
})
export class TenantStaffAuthorizationPersistenceModule {}
