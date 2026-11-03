import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { DOCTOR_PERSISTENCE } from '../persistence/platform-persistence.ports';
import { DoctorRepository } from './doctor.repository';

@Module({
  imports: [DatabaseModule],
  providers: [DoctorRepository, { provide: DOCTOR_PERSISTENCE, useExisting: DoctorRepository }],
  exports: [DOCTOR_PERSISTENCE],
})
export class DoctorPersistenceModule {}
