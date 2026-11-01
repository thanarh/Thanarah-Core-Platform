import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PlatformAuthorizationModule } from '../auth/platform-authorization.module';
import { PLATFORM_AUDIT_PERSISTENCE } from '../persistence/platform-persistence.ports';
import { PlatformAuditRepository } from './platform-audit.repository';
import { PlatformAuditService } from './platform-audit.service';

@Module({
  imports: [DatabaseModule, PlatformAuthorizationModule],
  providers: [
    PlatformAuditRepository,
    { provide: PLATFORM_AUDIT_PERSISTENCE, useExisting: PlatformAuditRepository },
    PlatformAuditService,
  ],
  exports: [PlatformAuditService],
})
export class PlatformSecurityModule {}
