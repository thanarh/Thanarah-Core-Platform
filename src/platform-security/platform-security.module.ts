import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PlatformAuditRepository } from './platform-audit.repository';
import { PlatformAuditService } from './platform-audit.service';

@Module({
  imports: [DatabaseModule],
  providers: [PlatformAuditRepository, PlatformAuditService],
  exports: [PlatformAuditRepository, PlatformAuditService],
})
export class PlatformSecurityModule {}
