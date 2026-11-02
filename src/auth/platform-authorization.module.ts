import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PlatformAuthorizationRepository } from './repositories/platform-authorization.repository';
import { PlatformAuthorizationService } from './services/platform-authorization.service';
import { PLATFORM_AUTHORIZATION_PERSISTENCE } from '../persistence/platform-persistence.ports';

@Module({
  imports: [DatabaseModule],
  providers: [
    PlatformAuthorizationRepository,
    { provide: PLATFORM_AUTHORIZATION_PERSISTENCE, useExisting: PlatformAuthorizationRepository },
    PlatformAuthorizationService,
  ],
  exports: [PlatformAuthorizationService],
})
export class PlatformAuthorizationModule {}
