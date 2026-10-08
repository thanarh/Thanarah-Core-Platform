import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync('prisma/schema.prisma', 'utf8');
const migration = readFileSync(
  'prisma/migrations/20261008120000_persistent_tenant_storage_foundation/migration.sql',
  'utf8',
);
const targetModel = schema.match(/model TenantStorageTarget\s*\{([\s\S]*?)\n\}/u)?.[1] ?? '';

describe('persistent tenant storage registry migration', () => {
  it('adds central registry metadata with inactive lifecycle defaults and tenant ownership', () => {
    expect(targetModel).toMatch(/tenantId\s+String\s+@db\.Char\(36\)/u);
    expect(targetModel).toMatch(/provider\s+TenantStorageProvider\s+@default\(MONGODB\)/u);
    expect(targetModel).toMatch(/connectionReference\s+String/u);
    expect(targetModel).toMatch(/databaseName\s+String\s+@db\.VarChar\(63\)/u);
    expect(targetModel).toMatch(/status\s+TenantStorageTargetStatus\s+@default\(INACTIVE\)/u);
    expect(targetModel).toMatch(/isPrimary\s+Boolean\s+@default\(false\)/u);
    expect(targetModel).toMatch(/tenant\s+Tenant\s+@relation\([^)]*onDelete:\s*Restrict/u);
    expect(schema).toMatch(/storageTargets\s+TenantStorageTarget\[\]/u);
    expect(migration).toContain('TenantStorageTarget_connectionReference_databaseName_key');
    expect(migration).toContain('TenantStorageTarget_tenantId_fkey');
  });

  it('stores no connection string and does not provision, move, or delete Patient data', () => {
    expect(targetModel).not.toMatch(/uri|password|credential|connectionString/iu);
    expect(migration).not.toMatch(/DROP\s+(TABLE|COLUMN|INDEX)|INSERT\s+INTO\s+`?Patient`?/iu);
    expect(migration).not.toMatch(/CREATE\s+TABLE\s+`?Patient`?/iu);
  });

  it('declares the only indexes used by current Patient reads and uniqueness checks', () => {
    const storageSource = readFileSync('src/tenant/mongo-tenant-patient.storage.ts', 'utf8');

    expect(storageSource).toContain('tenant_patient_number_unique');
    expect(storageSource).toContain('tenant_patient_status_created_idx');
    expect(storageSource).toContain('tenant_patient_created_idx');
    expect(storageSource).toMatch(/Explicit operator action/u);
    expect(storageSource).not.toMatch(/ensureIndexes\([^)]*\)\s*;\s*\/\/\s*startup/iu);
  });
});
