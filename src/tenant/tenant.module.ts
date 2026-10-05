import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { PlatformSecurityModule } from '../platform-security/platform-security.module';
import { TenantController } from './tenant.controller';
import { TenantMembershipController } from './tenant-membership.controller';
import { TenantMembershipRepository } from './tenant-membership.repository';
import { TenantMembershipRoleRepository } from './tenant-membership-role.repository';
import { TenantMembershipService } from './tenant-membership.service';
import { TenantAuthorizationGuard } from './tenant-authorization.guard';
import { TenantAuthorizationService } from './tenant-authorization.service';
import { TenantContextGuard } from './tenant-context.guard';
import {
  TenantMembershipValidatorService,
  TrustedTenantContextFactoryService,
} from './tenant-context.service';
import { FacilityController } from './facility.controller';
import { FacilityRepository } from './facility.repository';
import { FacilityService } from './facility.service';
import { TenantRoleBootstrapController } from './tenant-role-bootstrap.controller';
import { TenantRoleController } from './tenant-role.controller';
import { TenantRoleRepository } from './tenant-role.repository';
import { TenantRoleService } from './tenant-role.service';
import { TenantRepository } from './tenant.repository';
import { TenantService } from './tenant.service';

@Module({
  imports: [AuthModule, DatabaseModule, PlatformSecurityModule],
  controllers: [
    TenantController,
    TenantMembershipController,
    TenantRoleController,
    TenantRoleBootstrapController,
    FacilityController,
  ],
  providers: [
    TenantAuthorizationGuard,
    TenantAuthorizationService,
    TenantContextGuard,
    TenantMembershipRepository,
    TenantMembershipRoleRepository,
    TenantMembershipService,
    TenantMembershipValidatorService,
    FacilityRepository,
    FacilityService,
    TenantRepository,
    TenantRoleRepository,
    TenantRoleService,
    TenantService,
    TrustedTenantContextFactoryService,
  ],
  exports: [TenantMembershipService, TenantService],
})
export class TenantModule {}
