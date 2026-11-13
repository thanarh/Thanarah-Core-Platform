import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { TENANT_STAFF_PERSISTENCE } from '../persistence/platform-persistence.ports';
import { MongoTenantStaffRepository } from '../platform-mongo/mongo-tenant-staff.repository';

@Module({
  imports: [DatabaseModule],
  providers: [
    MongoTenantStaffRepository,
    { provide: TENANT_STAFF_PERSISTENCE, useExisting: MongoTenantStaffRepository },
  ],
  exports: [TENANT_STAFF_PERSISTENCE],
})
export class TenantStaffPersistenceModule {}
