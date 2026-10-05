import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { PlatformSecurityModule } from '../platform-security/platform-security.module';
import { TenantController } from './tenant.controller';
import { TenantRepository } from './tenant.repository';
import { TenantService } from './tenant.service';

@Module({
  imports: [AuthModule, DatabaseModule, PlatformSecurityModule],
  controllers: [TenantController],
  providers: [TenantRepository, TenantService],
  exports: [TenantService],
})
export class TenantModule {}
