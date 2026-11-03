import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import {
  BRANCH_PERSISTENCE,
  FACILITY_PERSISTENCE,
} from '../persistence/platform-persistence.ports';
import { BranchRepository } from './branch.repository';
import { FacilityRepository } from './facility.repository';

@Module({
  imports: [DatabaseModule],
  providers: [
    FacilityRepository,
    BranchRepository,
    { provide: FACILITY_PERSISTENCE, useExisting: FacilityRepository },
    { provide: BRANCH_PERSISTENCE, useExisting: BranchRepository },
  ],
  exports: [FACILITY_PERSISTENCE, BRANCH_PERSISTENCE],
})
export class TenantFacilityBranchPersistenceModule {}
