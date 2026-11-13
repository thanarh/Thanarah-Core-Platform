import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import {
  BRANCH_PERSISTENCE,
  FACILITY_PERSISTENCE,
} from '../persistence/platform-persistence.ports';
import { MongoFacilityRepository } from '../platform-mongo/mongo-facility.repository';
import { MongoBranchRepository } from '../platform-mongo/mongo-branch.repository';

@Module({
  imports: [DatabaseModule],
  providers: [
    MongoFacilityRepository,
    MongoBranchRepository,
    { provide: FACILITY_PERSISTENCE, useExisting: MongoFacilityRepository },
    { provide: BRANCH_PERSISTENCE, useExisting: MongoBranchRepository },
  ],
  exports: [FACILITY_PERSISTENCE, BRANCH_PERSISTENCE],
})
export class TenantFacilityBranchPersistenceModule {}
