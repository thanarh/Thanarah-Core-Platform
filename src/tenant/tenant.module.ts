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
import { TenantStaffController } from './tenant-staff.controller';
import { TenantStaffRepository } from './tenant-staff.repository';
import { TenantStaffService } from './tenant-staff.service';
import { TenantStaffRoleController } from './tenant-staff-role.controller';
import { TenantStaffRoleRepository } from './tenant-staff-role.repository';
import { TenantStaffRoleService } from './tenant-staff-role.service';
import { TenantStaffScopeController } from './tenant-staff-scope.controller';
import { TenantStaffScopeRepository } from './tenant-staff-scope.repository';
import { TenantStaffScopeService } from './tenant-staff-scope.service';
import { TenantHealthcareCatalogController } from './tenant-healthcare-catalog.controller';
import { HealthcareCatalogRepository } from './healthcare-catalog.repository';
import { HealthcareCatalogService } from './healthcare-catalog.service';
import { TenantServiceCatalogController } from './tenant-service-catalog.controller';
import { ServiceCatalogRepository } from './service-catalog.repository';
import { ServiceCatalogService } from './service-catalog.service';
import { DoctorController } from './doctor.controller';
import { DoctorRepository } from './doctor.repository';
import { DoctorService } from './doctor.service';
import { TenantPatientController } from './tenant-patient.controller';
import { PatientService } from './patient.service';
import { TenantAppointmentController } from './tenant-appointment.controller';
import { AppointmentService } from './appointment.service';
import { TenantStorageModule } from './tenant-storage.module';
import { FacilitySchedulingPolicyController } from './facility-scheduling-policy.controller';
import { FacilitySchedulingPolicyRepository } from './appointment-scheduling-policy.repository';
import { FacilitySchedulingPolicyService } from './appointment-scheduling-policy.service';
import { TenantWorkspaceController } from './tenant-workspace.controller';

@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    PlatformSecurityModule,
    TenantEntitlementModule,
    TenantQuotaModule,
    TenantStorageModule,
  ],
  controllers: [
    TenantController,
    TenantMembershipController,
    TenantWorkspaceController,
    TenantRoleController,
    TenantRoleBootstrapController,
    FacilityController,
    BranchController,
    TenantStaffController,
    TenantStaffRoleController,
    TenantStaffScopeController,
    TenantHealthcareCatalogController,
    TenantServiceCatalogController,
    DoctorController,
    TenantPatientController,
    TenantAppointmentController,
    FacilitySchedulingPolicyController,
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
    TenantStaffRepository,
    TenantStaffService,
    TenantStaffRoleRepository,
    TenantStaffRoleService,
    TenantStaffScopeRepository,
    TenantStaffScopeService,
    HealthcareCatalogRepository,
    HealthcareCatalogService,
    ServiceCatalogRepository,
    ServiceCatalogService,
    DoctorRepository,
    DoctorService,
    PatientService,
    AppointmentService,
    FacilitySchedulingPolicyRepository,
    FacilitySchedulingPolicyService,
    TenantRepository,
    TenantRoleRepository,
    TenantRoleService,
    TenantService,
    TrustedTenantContextFactoryService,
  ],
  exports: [TenantEntitlementModule, TenantQuotaModule, TenantMembershipService, TenantService],
})
export class TenantModule {}
