import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PlatformAuthorizationRepository } from './repositories/platform-authorization.repository';
import { PlatformAuthorizationService } from './services/platform-authorization.service';

@Module({
  imports: [DatabaseModule],
  providers: [PlatformAuthorizationRepository, PlatformAuthorizationService],
  exports: [PlatformAuthorizationService],
})
export class PlatformAuthorizationModule {}
