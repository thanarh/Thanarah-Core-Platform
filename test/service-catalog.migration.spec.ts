import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TENANT_ROLES,
  TENANT_PERMISSION_DEFINITIONS,
} from '../src/tenant/tenant-authorization.constants';

const migration = readFileSync(
  'prisma/migrations/20261007150000_tenant_service_catalog_foundation/migration.sql',
  'utf8',
);
const schema = readFileSync('prisma/schema.prisma', 'utf8');
const serviceModel = schema.match(/model Service\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

describe('Phase 25 tenant service catalog schema and migration', () => {
  it('adds only tenant-owned service data with tenant-scoped uniqueness and lifecycle indexes', () => {
    expect(serviceModel).toMatch(/tenantId\s+String\s+@db\.Char\(36\)/);
    expect(serviceModel).toMatch(/name\s+String\s+@db\.VarChar\(191\)/);
    expect(serviceModel).toMatch(/code\s+String\?\s+@db\.VarChar\(64\)/);
    expect(serviceModel).toMatch(/description\s+String\?\s+@db\.VarChar\(2000\)/);
    expect(serviceModel).toMatch(/status\s+TenantCatalogStatus\s+@default\(ACTIVE\)/);
    expect(serviceModel).toMatch(/@@unique\(\[tenantId,\s*name\]\)/);
    expect(serviceModel).toMatch(/@@unique\(\[tenantId,\s*code\]\)/);
    expect(serviceModel).toMatch(/@@index\(\[tenantId,\s*status,\s*createdAt\]\)/);
    expect(serviceModel).toMatch(/tenant\s+Tenant\s+@relation\([^)]*onDelete:\s*Restrict/);
    expect(schema).toMatch(/services\s+Service\[\]/);
    expect(migration).toContain('Service_tenantId_name_key');
    expect(migration).toContain('Service_tenantId_code_key');
    expect(migration).toContain('Service_tenantId_fkey');

    for (const forbidden of [
      'Doctor',
      'Staff',
      'Department',
      'Specialty',
      'Facility',
      'Branch',
      'Patient',
      'Appointment',
      'Visit',
      'Billing',
      'Insurance',
      'Subscription',
    ]) {
      expect(serviceModel).not.toMatch(new RegExp(`\\b${forbidden}\\b`, 'i'));
    }
  });

  it('uses the existing catalog lifecycle and adds the required service audit events', () => {
    expect(serviceModel).toMatch(/statusChangedAt\s+DateTime/);
    expect(serviceModel).toMatch(/suspendedAt\s+DateTime\?/);
    expect(serviceModel).toMatch(/deactivatedAt\s+DateTime\?/);
    for (const event of ['SERVICE_CREATED', 'SERVICE_UPDATED', 'SERVICE_STATUS_CHANGED']) {
      expect(schema).toContain(event);
      expect(migration).toContain(`'${event}'`);
    }
  });

  it('adds the least-privilege tenant service permissions to established role defaults', () => {
    const permissions = TENANT_PERMISSION_DEFINITIONS.map(({ code }) => code);
    for (const code of ['tenant.services.read', 'tenant.services.manage']) {
      expect(permissions).toContain(code);
      expect(migration).toContain(`'${code}'`);
    }

    const owner = DEFAULT_TENANT_ROLES.find(({ code }) => code === 'OWNER');
    const admin = DEFAULT_TENANT_ROLES.find(({ code }) => code === 'ADMIN');
    const member = DEFAULT_TENANT_ROLES.find(({ code }) => code === 'MEMBER');
    expect(owner?.permissionCodes).toContain('tenant.services.manage');
    expect(admin?.permissionCodes).toContain('tenant.services.manage');
    expect(member?.permissionCodes).toContain('tenant.services.read');
    expect(member?.permissionCodes).not.toContain('tenant.services.manage');
    expect(migration).toContain("`role`.`code` IN ('OWNER', 'ADMIN', 'MEMBER')");
    expect(migration).toContain("`role`.`code` IN ('OWNER', 'ADMIN')");
  });

  it('keeps the migration additive and limited to the Service catalog and its permissions', () => {
    expect(migration).not.toMatch(/\bDROP\s+(TABLE|COLUMN|INDEX)\b/i);
    expect(migration).not.toMatch(
      /\b(CREATE TABLE|ALTER TABLE)\s+`?(Doctor|Staff|Department|Specialty|Facility|Branch|Patient|Appointment|Visit|Billing|Insurance|Subscription)`?/i,
    );
  });
});
