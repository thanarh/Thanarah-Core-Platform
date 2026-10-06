import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync('prisma/schema.prisma', 'utf8');
const migration = readFileSync(
  'prisma/migrations/20261006150000_saas_usage_limits_foundation/migration.sql',
  'utf8',
);
const planFeatureModel = schema.match(/model PlanFeature\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

describe('usage limit foundation migration', () => {
  it('adds only optional limit definitions to the existing PlanFeature relationship', () => {
    expect(planFeatureModel).toMatch(/\bquotaLimits\s+Json\?/);
    expect(migration).toMatch(/ALTER TABLE `PlanFeature` ADD COLUMN `quotaLimits` JSON NULL/);
    expect(migration).not.toMatch(/CREATE TABLE|INSERT INTO|usageCount|currentUsage|counter/i);
    expect(schema).not.toMatch(/model\s+(?:TenantQuota|QuotaCounter|UsageEvent)\b/);
  });
});
