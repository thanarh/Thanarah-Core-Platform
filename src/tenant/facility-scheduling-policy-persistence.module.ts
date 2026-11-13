import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { FACILITY_SCHEDULING_POLICY_PERSISTENCE } from '../persistence/platform-persistence.ports';
import { MongoFacilitySchedulingPolicyRepository } from '../platform-mongo/mongo-facility-scheduling-policy.repository';

@Module({
  imports: [DatabaseModule],
  providers: [
    MongoFacilitySchedulingPolicyRepository,
    {
      provide: FACILITY_SCHEDULING_POLICY_PERSISTENCE,
      useExisting: MongoFacilitySchedulingPolicyRepository,
    },
  ],
  exports: [FACILITY_SCHEDULING_POLICY_PERSISTENCE],
})
export class FacilitySchedulingPolicyPersistenceModule {}
