import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PLATFORM_PERMISSION_CODES } from '../src/auth/platform-authorization.constants';

const schema = readFileSync('prisma/schema.prisma', 'utf8');
const migration = readFileSync(
  'prisma/migrations/20261006130000_saas_plans_foundation/migration.sql',
  'utf8',
);
const planModel = schema.match(/model Plan\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
const featureModel = schema.match(/model Feature\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
const planFeatureModel = schema.match(/model PlanFeature\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

describe('SaaS Plan and Feature foundation schema', () => {
  it('keeps Plans and Features reusable platform records without tenant or billing ownership', () => {
    expect(planModel).toMatch(/\bkey\s+String\s+@unique/);
    expect(featureModel).toMatch(/\bkey\s+String\s+@unique/);
    expect(planModel).not.toMatch(/\btenantId\b|\bprice\b|\bcurrency\b|\bbillingInterval\b/);
    expect(featureModel).not.toMatch(/\btenantId\b/);
    expect(migration).not.toMatch(/INSERT INTO `(?:Plan|Feature)`/);
  });

  it('uses a normalized PlanFeature with typed quota configuration and restrictive foreign keys', () => {
    expect(planFeatureModel).toMatch(/@@id\(\[planId, featureId\]\)/);
    expect(planFeatureModel).toMatch(/enabled\s+Boolean\s+@default\(true\)/);
    expect(planFeatureModel).toMatch(/\bquotaLimits\s+Json\?/);
    expect(migration).toContain('PlanFeature_planId_fkey');
    expect(migration).toContain('PlanFeature_featureId_fkey');
    expect(migration).toContain('ON DELETE RESTRICT');
    expect(migration).toContain('PlanFeature_featureId_createdAt_idx');
  });

  it('defines the Plan and Feature lifecycle and audits the implemented catalog actions', () => {
    expect(schema).toMatch(/enum PlanStatus\s*\{\s*ACTIVE\s+INACTIVE\s+ARCHIVED\s*\}/);
    expect(schema).toMatch(/enum FeatureStatus\s*\{\s*ACTIVE\s+INACTIVE\s*\}/);
    for (const event of [
      'PLAN_CREATED',
      'PLAN_UPDATED',
      'PLAN_ACTIVATED',
      'PLAN_DEACTIVATED',
      'PLAN_ARCHIVED',
      'FEATURE_CREATED',
      'FEATURE_UPDATED',
      'FEATURE_ACTIVATED',
      'FEATURE_DEACTIVATED',
      'PLAN_FEATURE_ATTACHED',
      'PLAN_FEATURE_UPDATED',
      'PLAN_FEATURE_DETACHED',
    ]) {
      expect(schema).toContain(event);
      expect(migration).toContain(`'${event}'`);
    }
  });

  it('adds only the required platform permissions and limits their baseline grants', () => {
    const permissions = [
      'plans.read',
      'plans.manage',
      'features.read',
      'features.manage',
      'plan_features.manage',
    ];
    for (const permission of permissions) {
      expect(PLATFORM_PERMISSION_CODES).toContain(permission);
      expect(migration).toContain(`'${permission}'`);
    }
    expect(migration).toContain('INSERT IGNORE INTO `PlatformPermission`');
    expect(migration).not.toContain('ON DUPLICATE KEY UPDATE');
    expect(migration).toContain("`role`.`code` IN ('OWNER', 'SUPER_ADMIN')");
    expect(migration).toContain("`role`.`code` = 'PLATFORM_ADMIN'");
    expect(migration).not.toMatch(/`role`\.`code`.*(SECURITY_ADMIN|SUPPORT_ADMIN)/);
  });
});
