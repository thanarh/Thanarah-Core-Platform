import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import {
  PLATFORM_AUTHORIZATION_PERSISTENCE,
  PLATFORM_SESSION_PERSISTENCE,
  PLATFORM_USER_PERSISTENCE,
} from '../persistence/platform-persistence.ports';
import { MongoPlatformAuthorizationRepository } from '../platform-mongo/mongo-platform-authorization.repository';
import { MongoPlatformSessionRepository } from '../platform-mongo/mongo-platform-session.repository';
import { MongoPlatformUserRepository } from '../platform-mongo/mongo-platform-user.repository';

@Module({
  imports: [DatabaseModule],
  providers: [
    MongoPlatformAuthorizationRepository,
    MongoPlatformSessionRepository,
    MongoPlatformUserRepository,
    {
      provide: PLATFORM_AUTHORIZATION_PERSISTENCE,
      useExisting: MongoPlatformAuthorizationRepository,
    },
    { provide: PLATFORM_SESSION_PERSISTENCE, useExisting: MongoPlatformSessionRepository },
    { provide: PLATFORM_USER_PERSISTENCE, useExisting: MongoPlatformUserRepository },
  ],
  exports: [
    MongoPlatformAuthorizationRepository,
    MongoPlatformSessionRepository,
    MongoPlatformUserRepository,
    PLATFORM_AUTHORIZATION_PERSISTENCE,
    PLATFORM_SESSION_PERSISTENCE,
    PLATFORM_USER_PERSISTENCE,
  ],
})
export class AuthPersistenceModule {}
