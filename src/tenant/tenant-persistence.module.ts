import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import {
  TENANT_MEMBERSHIP_PERSISTENCE,
  TENANT_PERSISTENCE,
} from '../persistence/platform-persistence.ports';
import { MongoTenantRepository } from '../platform-mongo/mongo-tenant.repository';
import { MongoTenantMembershipRepository } from '../platform-mongo/mongo-tenant-membership.repository';

@Module({
  imports: [DatabaseModule],
  providers: [
    MongoTenantRepository,
    MongoTenantMembershipRepository,
    { provide: TENANT_PERSISTENCE, useExisting: MongoTenantRepository },
    { provide: TENANT_MEMBERSHIP_PERSISTENCE, useExisting: MongoTenantMembershipRepository },
  ],
  exports: [TENANT_PERSISTENCE, TENANT_MEMBERSHIP_PERSISTENCE],
})
export class TenantPersistenceModule {}
