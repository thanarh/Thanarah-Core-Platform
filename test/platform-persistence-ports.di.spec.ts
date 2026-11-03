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
  TENANT_PERSISTENCE,
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
import { TenantRepository } from '../src/tenant/tenant.repository';

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
