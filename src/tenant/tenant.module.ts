import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { PlatformSecurityModule } from '../platform-security/platform-security.module';
import { TenantController } from './tenant.controller';
import { TenantMembershipController } from './tenant-membership.controller';
import { TenantMembershipRepository } from './tenant-membership.repository';
import { TenantMembershipService } from './tenant-membership.service';
import { TenantRepository } from './tenant.repository';
import { TenantService } from './tenant.service';

@Module({
  imports: [AuthModule, DatabaseModule, PlatformSecurityModule],
  controllers: [TenantController, TenantMembershipController],
  providers: [TenantMembershipRepository, TenantMembershipService, TenantRepository, TenantService],
  exports: [TenantMembershipService, TenantService],
})
export class TenantModule {}
