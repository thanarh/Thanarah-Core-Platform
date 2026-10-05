import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TENANT_ROLES,
  TENANT_PERMISSION_DEFINITIONS,
} from '../src/tenant/tenant-authorization.constants';

const migration = readFileSync(
  'prisma/migrations/20261006100000_facility_foundation/migration.sql',
  'utf8',
);
const schema = readFileSync('prisma/schema.prisma', 'utf8');

describe('Facility foundation schema and migration', () => {
  it('requires a tenant foreign key, restricts tenant deletion, and indexes tenant/status listing', () => {
    expect(schema).toMatch(/model Facility\s*\{[\s\S]*?tenantId\s+String\s+@db\.Char\(36\)/);
    expect(schema).toMatch(
      /tenant\s+Tenant\s+@relation\(fields: \[tenantId\], references: \[id\], onDelete: Restrict\)/,
    );
    expect(schema).toMatch(/@@index\(\[tenantId, status, createdAt\]\)/);
    expect(migration).toMatch(
      /FOREIGN KEY \(`tenantId`\) REFERENCES `Tenant` \(`id`\)\s+ON DELETE RESTRICT/,
    );
    expect(migration).toContain('Facility_tenantId_status_createdAt_idx');
  });

  it('defines only the Facility lifecycle states and administrative audit events', () => {
    expect(schema).toMatch(/enum FacilityStatus\s*\{\s*ACTIVE\s+SUSPENDED\s+DEACTIVATED\s*\}/);
    for (const event of [
      'FACILITY_CREATED',
      'FACILITY_UPDATED',
      'FACILITY_SUSPENDED',
      'FACILITY_ACTIVATED',
      'FACILITY_DEACTIVATED',
    ]) {
      expect(schema).toContain(event);
      expect(migration).toContain(`'${event}'`);
    }
  });

  it('seeds each tenant facility permission and backfills default roles by tenant role code', () => {
    for (const { code } of TENANT_PERMISSION_DEFINITIONS.filter(({ code }) =>
      code.startsWith('tenant.facilities.'),
    )) {
      expect(migration).toContain(`'${code}'`);
    }
    expect(migration).toContain('INSERT IGNORE INTO `TenantRolePermission`');
    expect(migration).toContain("`role`.`code` IN ('OWNER', 'ADMIN', 'MEMBER')");
    expect(migration).toContain("`role`.`code` IN ('OWNER', 'ADMIN')");
    expect(migration).toContain("`role`.`code` = 'OWNER'");

    const owner = DEFAULT_TENANT_ROLES.find(({ code }) => code === 'OWNER');
    const admin = DEFAULT_TENANT_ROLES.find(({ code }) => code === 'ADMIN');
    const member = DEFAULT_TENANT_ROLES.find(({ code }) => code === 'MEMBER');
    expect(owner?.permissionCodes).toContain('tenant.facilities.deactivate');
    expect(admin?.permissionCodes).not.toContain('tenant.facilities.deactivate');
    expect(member?.permissionCodes).toEqual(expect.arrayContaining(['tenant.facilities.read']));
  });
});
