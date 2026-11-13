import { Test as NestTest, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/database/prisma.service';
import { PlatformMongoClientManager } from '../src/platform-mongo/platform-mongo.client.manager';
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
import { MongoPlatformAuthorizationRepository as PlatformAuthorizationRepository } from '../src/platform-mongo/mongo-platform-authorization.repository';
import { MongoPlatformSessionRepository as PlatformSessionRepository } from '../src/platform-mongo/mongo-platform-session.repository';
import { MongoPlatformUserRepository as PlatformUserRepository } from '../src/platform-mongo/mongo-platform-user.repository';
import { MongoPlatformFeatureRepository as FeatureRepository } from '../src/platform-mongo/mongo-platform-feature.repository';
import { PlatformCatalogModule } from '../src/platform-catalog/platform-catalog.module';
import { MongoPlatformPlanRepository as PlanRepository } from '../src/platform-mongo/mongo-platform-plan.repository';
import { MongoPlatformAuditRepository as PlatformAuditRepository } from '../src/platform-mongo/mongo-platform-audit.repository';
import { MongoTenantMembershipRepository as TenantMembershipRepository } from '../src/platform-mongo/mongo-tenant-membership.repository';
import { TenantPersistenceModule } from '../src/tenant/tenant-persistence.module';
import { MongoTenantMembershipRoleRepository as TenantMembershipRoleRepository } from '../src/platform-mongo/mongo-tenant-membership-role.repository';
import { TenantRolePersistenceModule } from '../src/tenant/tenant-role-persistence.module';
import { MongoTenantRoleRepository as TenantRoleRepository } from '../src/platform-mongo/mongo-tenant-role.repository';
import { TenantFacilityBranchPersistenceModule } from '../src/tenant/tenant-facility-branch-persistence.module';
import { MongoFacilityRepository as FacilityRepository } from '../src/platform-mongo/mongo-facility.repository';
import { MongoBranchRepository as BranchRepository } from '../src/platform-mongo/mongo-branch.repository';
import { SubscriptionPersistenceModule } from '../src/subscriptions/subscription-persistence.module';
import { MongoSubscriptionRepository as SubscriptionRepository } from '../src/platform-mongo/mongo-subscription.repository';
import { TenantCatalogPersistenceModule } from '../src/tenant/tenant-catalog-persistence.module';
import { MongoHealthcareCatalogRepository as HealthcareCatalogRepository } from '../src/platform-mongo/mongo-healthcare-catalog.repository';
import { MongoServiceCatalogRepository as ServiceCatalogRepository } from '../src/platform-mongo/mongo-service-catalog.repository';
import { TenantStaffPersistenceModule } from '../src/tenant/tenant-staff-persistence.module';
import { MongoTenantStaffRepository as TenantStaffRepository } from '../src/platform-mongo/mongo-tenant-staff.repository';
import { TenantStaffAuthorizationPersistenceModule } from '../src/tenant/tenant-staff-authorization-persistence.module';
import { MongoTenantStaffRoleRepository as TenantStaffRoleRepository } from '../src/platform-mongo/mongo-tenant-staff-role.repository';
import { MongoTenantStaffScopeRepository as TenantStaffScopeRepository } from '../src/platform-mongo/mongo-tenant-staff-scope.repository';
import { FacilitySchedulingPolicyPersistenceModule } from '../src/tenant/facility-scheduling-policy-persistence.module';
import { MongoFacilitySchedulingPolicyRepository as FacilitySchedulingPolicyRepository } from '../src/platform-mongo/mongo-facility-scheduling-policy.repository';
import { MongoTenantRepository as TenantRepository } from '../src/platform-mongo/mongo-tenant.repository';
import { DoctorPersistenceModule } from '../src/tenant/doctor-persistence.module';
import { MongoDoctorRepository as DoctorRepository } from '../src/platform-mongo/mongo-doctor.repository';

// Binding tests do not open sockets. Compiled full-app tests exercise real DI.
const Test = {
  createTestingModule: (...args: Parameters<typeof NestTest.createTestingModule>) =>
    NestTest.createTestingModule(...args)
      .overrideProvider(PlatformMongoClientManager)
      .useValue({}),
};

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

  it('binds catalog and audit ports to MongoDB without a Prisma provider', () => {
    expect(() => moduleRef.get(PrismaService, { strict: false })).toThrow();
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

  it('binds identity, session/history, and authorization ports to MongoDB', () => {
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

  it('binds tenant and membership ports to MongoDB', () => {
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

  it('binds role and assignment ports to MongoDB', () => {
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

  it('binds facility and branch ports to MongoDB', () => {
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

  it('binds the subscription port to MongoDB', () => {
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

  it('binds healthcare and service catalog ports to MongoDB', () => {
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

  it('binds the tenant staff port to MongoDB', () => {
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

  it('binds staff role and scope ports to MongoDB', () => {
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

  it('binds the scheduling policy port to MongoDB', () => {
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

  it('binds the doctor port to MongoDB', () => {
    expect(moduleRef.get(DOCTOR_PERSISTENCE, { strict: false })).toBeInstanceOf(DoctorRepository);
  });
});
