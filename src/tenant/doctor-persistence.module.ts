import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { DOCTOR_PERSISTENCE } from '../persistence/platform-persistence.ports';
import { MongoDoctorRepository } from '../platform-mongo/mongo-doctor.repository';

@Module({
  imports: [DatabaseModule],
  providers: [
    MongoDoctorRepository,
    { provide: DOCTOR_PERSISTENCE, useExisting: MongoDoctorRepository },
  ],
  exports: [DOCTOR_PERSISTENCE],
})
export class DoctorPersistenceModule {}
