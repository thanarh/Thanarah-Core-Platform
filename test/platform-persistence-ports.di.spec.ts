import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/database/prisma.service';
import {
  FEATURE_PERSISTENCE,
  PLAN_PERSISTENCE,
  PLATFORM_AUDIT_PERSISTENCE,
} from '../src/persistence/platform-persistence.ports';
import { FeatureRepository } from '../src/platform-catalog/feature.repository';
import { PlatformCatalogModule } from '../src/platform-catalog/platform-catalog.module';
import { PlanRepository } from '../src/platform-catalog/plan.repository';
import { PlatformAuditRepository } from '../src/platform-security/platform-audit.repository';

describe('central persistence port providers', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PlatformCatalogModule],
    })
      .overrideProvider(PrismaService)
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
