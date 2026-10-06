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
import { BranchController } from './branch.controller';
import { BranchRepository } from './branch.repository';
import { BranchService } from './branch.service';
import { TenantRoleBootstrapController } from './tenant-role-bootstrap.controller';
import { TenantRoleController } from './tenant-role.controller';
import { TenantRoleRepository } from './tenant-role.repository';
import { TenantRoleService } from './tenant-role.service';
import { TenantRepository } from './tenant.repository';
import { TenantService } from './tenant.service';
import { TenantEntitlementModule } from './tenant-entitlement.module';
import { TenantQuotaModule } from './tenant-quota.module';

@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    PlatformSecurityModule,
    TenantEntitlementModule,
    TenantQuotaModule,
  ],
  controllers: [
    TenantController,
    TenantMembershipController,
    TenantRoleController,
    TenantRoleBootstrapController,
    FacilityController,
    BranchController,
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
    BranchRepository,
    BranchService,
    TenantRepository,
    TenantRoleRepository,
    TenantRoleService,
    TenantService,
    TrustedTenantContextFactoryService,
  ],
  exports: [TenantEntitlementModule, TenantQuotaModule, TenantMembershipService, TenantService],
})
export class TenantModule {}
