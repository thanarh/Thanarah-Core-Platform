import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConfigModule } from '../config/config.module';
import { DatabaseModule } from '../database/database.module';
import { PlatformSecurityModule } from '../platform-security/platform-security.module';
import { TenantController } from './tenant.controller';
import { TenantMembershipController } from './tenant-membership.controller';
import { TenantMembershipDirectoryController } from './tenant-membership-directory.controller';
import { TenantMembershipService } from './tenant-membership.service';
import { TenantAuthorizationGuard } from './tenant-authorization.guard';
import { TenantAuthorizationService } from './tenant-authorization.service';
import { TenantContextGuard } from './tenant-context.guard';
import {
  TenantMembershipValidatorService,
  TrustedTenantContextFactoryService,
} from './tenant-context.service';
import { FacilityController } from './facility.controller';
import { FacilityService } from './facility.service';
import { BranchController } from './branch.controller';
import { BranchService } from './branch.service';
import { TenantRoleBootstrapController } from './tenant-role-bootstrap.controller';
import { TenantRoleController } from './tenant-role.controller';
import { TenantRoleService } from './tenant-role.service';
import { TenantService } from './tenant.service';
import { TenantPersistenceModule } from './tenant-persistence.module';
import { TenantRolePersistenceModule } from './tenant-role-persistence.module';
import { TenantFacilityBranchPersistenceModule } from './tenant-facility-branch-persistence.module';
import { TenantCatalogPersistenceModule } from './tenant-catalog-persistence.module';
import { TenantStaffPersistenceModule } from './tenant-staff-persistence.module';
import { TenantStaffAuthorizationPersistenceModule } from './tenant-staff-authorization-persistence.module';
import { FacilitySchedulingPolicyPersistenceModule } from './facility-scheduling-policy-persistence.module';
import { DoctorPersistenceModule } from './doctor-persistence.module';
import { TenantEntitlementModule } from './tenant-entitlement.module';
import { TenantQuotaModule } from './tenant-quota.module';
import { TenantStaffController } from './tenant-staff.controller';
import { TenantStaffService } from './tenant-staff.service';
import { TenantStaffRoleController } from './tenant-staff-role.controller';
import { TenantStaffRoleService } from './tenant-staff-role.service';
import { TenantStaffScopeController } from './tenant-staff-scope.controller';
import { TenantStaffScopeService } from './tenant-staff-scope.service';
import { TenantHealthcareCatalogController } from './tenant-healthcare-catalog.controller';
import { HealthcareCatalogService } from './healthcare-catalog.service';
import { TenantServiceCatalogController } from './tenant-service-catalog.controller';
import { ServiceCatalogService } from './service-catalog.service';
import { DoctorController } from './doctor.controller';
import { DoctorService } from './doctor.service';
import { TenantPatientController } from './tenant-patient.controller';
import { PatientService } from './patient.service';
import { TenantAppointmentController } from './tenant-appointment.controller';
import { AppointmentService } from './appointment.service';
import { TenantStorageModule } from './tenant-storage.module';
import { FacilitySchedulingPolicyController } from './facility-scheduling-policy.controller';
import { FacilitySchedulingPolicyService } from './appointment-scheduling-policy.service';
import { TenantWorkspaceController } from './tenant-workspace.controller';
import { TenantEncounterController } from './tenant-encounter.controller';
import { EncounterService } from './encounter.service';
import { TenantClinicFinanceController } from './tenant-clinic-finance.controller';
import { ClinicFinanceService } from './clinic-finance.service';
import { ClinicFinanceRepository } from './clinic-finance.repository';
import { TenantSubscriptionPortalController } from './tenant-subscription-portal.controller';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { PatientPortalController } from './patient-portal.controller';
import { PatientPortalService } from './patient-portal.service';

@Module({
  imports: [
    AuthModule,
    ConfigModule,
    DatabaseModule,
    PlatformSecurityModule,
    TenantEntitlementModule,
    TenantQuotaModule,
    TenantStorageModule,
    TenantPersistenceModule,
    TenantRolePersistenceModule,
    TenantFacilityBranchPersistenceModule,
    TenantCatalogPersistenceModule,
    TenantStaffPersistenceModule,
    TenantStaffAuthorizationPersistenceModule,
    FacilitySchedulingPolicyPersistenceModule,
    DoctorPersistenceModule,
    SubscriptionsModule,
  ],
  controllers: [
    TenantController,
    TenantMembershipController,
    TenantMembershipDirectoryController,
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
    TenantEncounterController,
    TenantClinicFinanceController,
    TenantSubscriptionPortalController,
    PatientPortalController,
  ],
  providers: [
    TenantAuthorizationGuard,
    TenantAuthorizationService,
    TenantContextGuard,
    TenantMembershipService,
    TenantMembershipValidatorService,
    FacilityService,
    BranchService,
    TenantStaffService,
    TenantStaffRoleService,
    TenantStaffScopeService,
    HealthcareCatalogService,
    ServiceCatalogService,
    DoctorService,
    PatientService,
    AppointmentService,
    FacilitySchedulingPolicyService,
    EncounterService,
    ClinicFinanceService,
    ClinicFinanceRepository,
    TenantRoleService,
    TenantService,
    TrustedTenantContextFactoryService,
    PatientPortalService,
  ],
  exports: [
    TenantEntitlementModule,
    TenantQuotaModule,
    TenantMembershipService,
    TenantService,
    TenantStorageModule,
    TenantAuthorizationGuard,
    TenantAuthorizationService,
    TenantContextGuard,
    TenantMembershipValidatorService,
    TrustedTenantContextFactoryService,
  ],
})
export class TenantModule {}
