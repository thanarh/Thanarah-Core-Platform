import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import {
  PLATFORM_AUTHORIZATION_PERSISTENCE,
  PLATFORM_SESSION_PERSISTENCE,
  PLATFORM_USER_PERSISTENCE,
} from '../persistence/platform-persistence.ports';
import { PlatformAuthorizationRepository } from './repositories/platform-authorization.repository';
import { PlatformSessionRepository } from './repositories/platform-session.repository';
import { PlatformUserRepository } from './repositories/platform-user.repository';

@Module({
  imports: [DatabaseModule],
  providers: [
    PlatformAuthorizationRepository,
    PlatformSessionRepository,
    PlatformUserRepository,
    { provide: PLATFORM_AUTHORIZATION_PERSISTENCE, useExisting: PlatformAuthorizationRepository },
    { provide: PLATFORM_SESSION_PERSISTENCE, useExisting: PlatformSessionRepository },
    { provide: PLATFORM_USER_PERSISTENCE, useExisting: PlatformUserRepository },
  ],
  exports: [
    PlatformAuthorizationRepository,
    PlatformSessionRepository,
    PlatformUserRepository,
    PLATFORM_AUTHORIZATION_PERSISTENCE,
    PLATFORM_SESSION_PERSISTENCE,
    PLATFORM_USER_PERSISTENCE,
  ],
})
export class AuthPersistenceModule {}
