import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/database/prisma.service';
import { PlatformAuthGuard } from '../src/auth/guards/platform-auth.guard';
import { AccessTokenService } from '../src/auth/services/access-token.service';
import {
  FEATURE_PERSISTENCE,
  PLAN_PERSISTENCE,
  PLATFORM_AUDIT_PERSISTENCE,
  PLATFORM_AUTHORIZATION_PERSISTENCE,
  PLATFORM_SESSION_PERSISTENCE,
  PLATFORM_USER_PERSISTENCE,
  TENANT_MEMBERSHIP_PERSISTENCE,
  TENANT_MEMBERSHIP_ROLE_PERSISTENCE,
  TENANT_PERSISTENCE,
  TENANT_ROLE_PERSISTENCE,
  FACILITY_PERSISTENCE,
  BRANCH_PERSISTENCE,
  SUBSCRIPTION_PERSISTENCE,
  HEALTHCARE_CATALOG_PERSISTENCE,
  SERVICE_CATALOG_PERSISTENCE,
  TENANT_STAFF_PERSISTENCE,
  TENANT_STAFF_ROLE_PERSISTENCE,
  TENANT_STAFF_SCOPE_PERSISTENCE,
  FACILITY_SCHEDULING_POLICY_PERSISTENCE,
  DOCTOR_PERSISTENCE,
} from '../src/persistence/platform-persistence.ports';
import { AuthPersistenceModule } from '../src/auth/auth-persistence.module';
import { PlatformAuthorizationModule } from '../src/auth/platform-authorization.module';
import { PlatformAuthorizationRepository } from '../src/auth/repositories/platform-authorization.repository';
import { PlatformSessionRepository } from '../src/auth/repositories/platform-session.repository';
import { PlatformUserRepository } from '../src/auth/repositories/platform-user.repository';
import { FeatureRepository } from '../src/platform-catalog/feature.repository';
import { PlatformCatalogModule } from '../src/platform-catalog/platform-catalog.module';
import { PlanRepository } from '../src/platform-catalog/plan.repository';
import { PlatformAuditRepository } from '../src/platform-security/platform-audit.repository';
import { TenantMembershipRepository } from '../src/tenant/tenant-membership.repository';
import { TenantPersistenceModule } from '../src/tenant/tenant-persistence.module';
import { TenantMembershipRoleRepository } from '../src/tenant/tenant-membership-role.repository';
import { TenantRolePersistenceModule } from '../src/tenant/tenant-role-persistence.module';
import { TenantRoleRepository } from '../src/tenant/tenant-role.repository';
import { TenantFacilityBranchPersistenceModule } from '../src/tenant/tenant-facility-branch-persistence.module';
import { FacilityRepository } from '../src/tenant/facility.repository';
import { BranchRepository } from '../src/tenant/branch.repository';
import { SubscriptionPersistenceModule } from '../src/subscriptions/subscription-persistence.module';
import { SubscriptionRepository } from '../src/subscriptions/subscription.repository';
import { TenantCatalogPersistenceModule } from '../src/tenant/tenant-catalog-persistence.module';
import { HealthcareCatalogRepository } from '../src/tenant/healthcare-catalog.repository';
import { ServiceCatalogRepository } from '../src/tenant/service-catalog.repository';
import { TenantStaffPersistenceModule } from '../src/tenant/tenant-staff-persistence.module';
import { TenantStaffRepository } from '../src/tenant/tenant-staff.repository';
import { TenantStaffAuthorizationPersistenceModule } from '../src/tenant/tenant-staff-authorization-persistence.module';
import { TenantStaffRoleRepository } from '../src/tenant/tenant-staff-role.repository';
import { TenantStaffScopeRepository } from '../src/tenant/tenant-staff-scope.repository';
import { FacilitySchedulingPolicyPersistenceModule } from '../src/tenant/facility-scheduling-policy-persistence.module';
import { FacilitySchedulingPolicyRepository } from '../src/tenant/appointment-scheduling-policy.repository';
import { TenantRepository } from '../src/tenant/tenant.repository';
import { DoctorPersistenceModule } from '../src/tenant/doctor-persistence.module';
import { DoctorRepository } from '../src/tenant/doctor.repository';

describe('central persistence port providers', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PlatformCatalogModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(PlatformAuthGuard)
      .useValue({})
      .overrideProvider(AccessTokenService)
      .useValue({})
      .compile();
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('binds catalog and audit ports to their Prisma repositories', () => {
    expect(moduleRef.get(FEATURE_PERSISTENCE)).toBeInstanceOf(FeatureRepository);
    expect(moduleRef.get(PLAN_PERSISTENCE)).toBeInstanceOf(PlanRepository);
    expect(moduleRef.get(PLATFORM_AUDIT_PERSISTENCE)).toBeInstanceOf(PlatformAuditRepository);
  });
});

describe('platform authentication persistence port providers', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AuthPersistenceModule, PlatformAuthorizationModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('binds identity, session/history, and authorization ports to Prisma repositories', () => {
    expect(moduleRef.get(PLATFORM_USER_PERSISTENCE, { strict: false })).toBeInstanceOf(
      PlatformUserRepository,
    );
    expect(moduleRef.get(PLATFORM_SESSION_PERSISTENCE, { strict: false })).toBeInstanceOf(
      PlatformSessionRepository,
    );
    expect(moduleRef.get(PLATFORM_AUTHORIZATION_PERSISTENCE, { strict: false })).toBeInstanceOf(
      PlatformAuthorizationRepository,
    );
  });
});

describe('tenant persistence port providers', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [TenantPersistenceModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('binds tenant and membership ports to their Prisma repositories', () => {
    expect(moduleRef.get(TENANT_PERSISTENCE, { strict: false })).toBeInstanceOf(TenantRepository);
    expect(moduleRef.get(TENANT_MEMBERSHIP_PERSISTENCE, { strict: false })).toBeInstanceOf(
      TenantMembershipRepository,
    );
  });
});

describe('tenant role persistence port providers', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [TenantRolePersistenceModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('binds role and assignment ports to their Prisma repositories', () => {
    expect(moduleRef.get(TENANT_ROLE_PERSISTENCE, { strict: false })).toBeInstanceOf(
      TenantRoleRepository,
    );
    expect(moduleRef.get(TENANT_MEMBERSHIP_ROLE_PERSISTENCE, { strict: false })).toBeInstanceOf(
      TenantMembershipRoleRepository,
    );
  });
});

describe('tenant facility and branch persistence port providers', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [TenantFacilityBranchPersistenceModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('binds facility and branch ports to their Prisma repositories', () => {
    expect(moduleRef.get(FACILITY_PERSISTENCE, { strict: false })).toBeInstanceOf(
      FacilityRepository,
    );
    expect(moduleRef.get(BRANCH_PERSISTENCE, { strict: false })).toBeInstanceOf(BranchRepository);
  });
});

describe('subscription persistence port provider', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [SubscriptionPersistenceModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('binds the subscription port to its Prisma repository', () => {
    expect(moduleRef.get(SUBSCRIPTION_PERSISTENCE, { strict: false })).toBeInstanceOf(
      SubscriptionRepository,
    );
  });
});

describe('tenant catalog persistence port providers', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [TenantCatalogPersistenceModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('binds healthcare and service catalog ports to their Prisma repositories', () => {
    expect(moduleRef.get(HEALTHCARE_CATALOG_PERSISTENCE, { strict: false })).toBeInstanceOf(
      HealthcareCatalogRepository,
    );
    expect(moduleRef.get(SERVICE_CATALOG_PERSISTENCE, { strict: false })).toBeInstanceOf(
      ServiceCatalogRepository,
    );
  });
});

describe('tenant staff persistence port provider', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [TenantStaffPersistenceModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('binds the tenant staff port to its Prisma repository', () => {
    expect(moduleRef.get(TENANT_STAFF_PERSISTENCE, { strict: false })).toBeInstanceOf(
      TenantStaffRepository,
    );
  });
});

describe('tenant staff authorization persistence port providers', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [TenantStaffAuthorizationPersistenceModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('binds staff role and scope ports to their Prisma repositories', () => {
    expect(moduleRef.get(TENANT_STAFF_ROLE_PERSISTENCE, { strict: false })).toBeInstanceOf(
      TenantStaffRoleRepository,
    );
    expect(moduleRef.get(TENANT_STAFF_SCOPE_PERSISTENCE, { strict: false })).toBeInstanceOf(
      TenantStaffScopeRepository,
    );
  });
});

describe('facility scheduling policy persistence port provider', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [FacilitySchedulingPolicyPersistenceModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('binds the scheduling policy port to its Prisma repository', () => {
    expect(moduleRef.get(FACILITY_SCHEDULING_POLICY_PERSISTENCE, { strict: false })).toBeInstanceOf(
      FacilitySchedulingPolicyRepository,
    );
  });
});

describe('doctor persistence port provider', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [DoctorPersistenceModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('binds the doctor port to its Prisma repository', () => {
    expect(moduleRef.get(DOCTOR_PERSISTENCE, { strict: false })).toBeInstanceOf(DoctorRepository);
  });
});
