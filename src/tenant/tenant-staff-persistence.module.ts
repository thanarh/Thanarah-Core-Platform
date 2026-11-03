import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { TENANT_STAFF_PERSISTENCE } from '../persistence/platform-persistence.ports';
import { TenantStaffRepository } from './tenant-staff.repository';

@Module({
  imports: [DatabaseModule],
  providers: [
    TenantStaffRepository,
    { provide: TENANT_STAFF_PERSISTENCE, useExisting: TenantStaffRepository },
  ],
  exports: [TENANT_STAFF_PERSISTENCE],
})
export class TenantStaffPersistenceModule {}
