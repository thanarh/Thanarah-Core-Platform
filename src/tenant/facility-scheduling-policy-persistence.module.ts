import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { FACILITY_SCHEDULING_POLICY_PERSISTENCE } from '../persistence/platform-persistence.ports';
import { FacilitySchedulingPolicyRepository } from './appointment-scheduling-policy.repository';

@Module({
  imports: [DatabaseModule],
  providers: [
    FacilitySchedulingPolicyRepository,
    {
      provide: FACILITY_SCHEDULING_POLICY_PERSISTENCE,
      useExisting: FacilitySchedulingPolicyRepository,
    },
  ],
  exports: [FACILITY_SCHEDULING_POLICY_PERSISTENCE],
})
export class FacilitySchedulingPolicyPersistenceModule {}
