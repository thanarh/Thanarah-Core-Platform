import { Module } from '@nestjs/common';
import { AuthPersistenceModule } from './auth-persistence.module';
import { PlatformAuthorizationService } from './services/platform-authorization.service';

@Module({
  imports: [AuthPersistenceModule],
  providers: [PlatformAuthorizationService],
  exports: [PlatformAuthorizationService],
})
export class PlatformAuthorizationModule {}
