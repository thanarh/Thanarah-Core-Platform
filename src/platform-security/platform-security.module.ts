import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PlatformAuthorizationModule } from '../auth/platform-authorization.module';
import { PLATFORM_AUDIT_PERSISTENCE } from '../persistence/platform-persistence.ports';
import { PlatformAuditService } from './platform-audit.service';
import { MongoPlatformAuditRepository } from '../platform-mongo/mongo-platform-audit.repository';

@Module({
  imports: [DatabaseModule, PlatformAuthorizationModule],
  providers: [
    MongoPlatformAuditRepository,
    { provide: PLATFORM_AUDIT_PERSISTENCE, useExisting: MongoPlatformAuditRepository },
    PlatformAuditService,
  ],
  exports: [PlatformAuditService],
})
export class PlatformSecurityModule {}
