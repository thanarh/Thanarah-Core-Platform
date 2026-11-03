import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import {
  TENANT_STAFF_ROLE_PERSISTENCE,
  TENANT_STAFF_SCOPE_PERSISTENCE,
} from '../persistence/platform-persistence.ports';
import { TenantStaffRoleRepository } from './tenant-staff-role.repository';
import { TenantStaffScopeRepository } from './tenant-staff-scope.repository';

@Module({
  imports: [DatabaseModule],
  providers: [
    TenantStaffRoleRepository,
    TenantStaffScopeRepository,
    { provide: TENANT_STAFF_ROLE_PERSISTENCE, useExisting: TenantStaffRoleRepository },
    { provide: TENANT_STAFF_SCOPE_PERSISTENCE, useExisting: TenantStaffScopeRepository },
  ],
  exports: [TENANT_STAFF_ROLE_PERSISTENCE, TENANT_STAFF_SCOPE_PERSISTENCE],
})
export class TenantStaffAuthorizationPersistenceModule {}
