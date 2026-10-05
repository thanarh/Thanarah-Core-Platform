import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PlatformAuthorizationModule } from '../auth/platform-authorization.module';
import { PlatformAuditRepository } from './platform-audit.repository';
import { PlatformAuditService } from './platform-audit.service';

@Module({
  imports: [DatabaseModule, PlatformAuthorizationModule],
  providers: [PlatformAuditRepository, PlatformAuditService],
  exports: [PlatformAuditService],
})
export class PlatformSecurityModule {}
