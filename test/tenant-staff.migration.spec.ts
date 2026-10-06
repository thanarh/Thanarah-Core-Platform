import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TENANT_ROLES,
  TENANT_PERMISSION_DEFINITIONS,
} from '../src/tenant/tenant-authorization.constants';

const migration = readFileSync(
  'prisma/migrations/20261006160000_tenant_staff_foundation/migration.sql',
  'utf8',
);
const schema = readFileSync('prisma/schema.prisma', 'utf8');
const staffModel = schema.match(/model Staff\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

describe('Tenant Staff foundation schema and migration', () => {
  it('ties each Staff row to the same tenant and user as its existing membership', () => {
    expect(staffModel).toMatch(/tenantId\s+String\s+@db\.Char\(36\)/);
    expect(staffModel).toMatch(/userId\s+String\s+@db\.Char\(36\)/);
    expect(staffModel).toMatch(/membershipId\s+String\s+@db\.Char\(36\)/);
    expect(staffModel).toMatch(
      /fields: \[membershipId, tenantId, userId\], references: \[id, tenantId, platformUserId\]/,
    );
    expect(schema).toContain('@@unique([id, tenantId, platformUserId])');
    expect(staffModel).toContain('@@unique([tenantId, userId])');
    expect(migration).toContain('Staff_membershipId_tenantId_userId_fkey');
    expect(migration).toContain(
      'REFERENCES `TenantMembership` (`id`, `tenantId`, `platformUserId`)',
    );
    expect(migration).toContain('Staff_tenantId_userId_key');
  });

  it('adds only descriptive profile fields and the administrative lifecycle', () => {
    expect(staffModel).toContain('displayName');
    expect(staffModel).toContain('jobTitle');
    expect(schema).toMatch(/enum StaffStatus\s*\{\s*ACTIVE\s+SUSPENDED\s+DEACTIVATED\s*\}/);
    expect(staffModel).toContain('@@index([tenantId, status, createdAt])');
    expect(staffModel).not.toMatch(/\b(role|roleId|permissions|license|specialty|patientId)\b/i);
    for (const event of [
      'STAFF_CREATED',
      'STAFF_UPDATED',
      'STAFF_SUSPENDED',
      'STAFF_ACTIVATED',
      'STAFF_DEACTIVATED',
    ]) {
      expect(schema).toContain(event);
      expect(migration).toContain(`'${event}'`);
    }
  });

  it('seeds read/manage permissions to the default tenant roles', () => {
    const staffPermissions = TENANT_PERMISSION_DEFINITIONS.filter(({ code }) =>
      code.startsWith('tenant.staff.'),
    );
    expect(staffPermissions.map(({ code }) => code)).toEqual([
      'tenant.staff.read',
      'tenant.staff.manage',
    ]);
    for (const { code } of staffPermissions) expect(migration).toContain(`'${code}'`);
    expect(migration).toContain('INSERT IGNORE INTO `TenantRolePermission`');
    expect(migration).toContain("`role`.`code` IN ('OWNER', 'ADMIN', 'MEMBER')");
    expect(migration).toContain("`role`.`code` IN ('OWNER', 'ADMIN')");

    const owner = DEFAULT_TENANT_ROLES.find(({ code }) => code === 'OWNER');
    const admin = DEFAULT_TENANT_ROLES.find(({ code }) => code === 'ADMIN');
    const member = DEFAULT_TENANT_ROLES.find(({ code }) => code === 'MEMBER');
    expect(owner?.permissionCodes).toContain('tenant.staff.manage');
    expect(admin?.permissionCodes).toContain('tenant.staff.manage');
    expect(member?.permissionCodes).toContain('tenant.staff.read');
    expect(member?.permissionCodes).not.toContain('tenant.staff.manage');
  });
});
