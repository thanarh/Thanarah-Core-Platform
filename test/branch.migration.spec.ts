import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TENANT_ROLES,
  TENANT_PERMISSION_DEFINITIONS,
} from '../src/tenant/tenant-authorization.constants';

const migration = readFileSync(
  'prisma/migrations/20261006110000_branch_foundation/migration.sql',
  'utf8',
);
const schema = readFileSync('prisma/schema.prisma', 'utf8');
const branchModel = schema.match(/model Branch\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

describe('Branch foundation schema and migration', () => {
  it('requires exactly one parent Facility and does not duplicate tenant ownership', () => {
    expect(branchModel).toMatch(/facilityId\s+String\s+@db\.Char\(36\)/);
    expect(branchModel).toMatch(
      /facility\s+Facility\s+@relation\(fields: \[facilityId\], references: \[id\], onDelete: Restrict\)/,
    );
    expect(branchModel).not.toMatch(/\btenantId\b/);
    expect(branchModel).toMatch(/@@index\(\[facilityId, status, createdAt\]\)/);
    expect(migration).toMatch(
      /FOREIGN KEY \(`facilityId`\) REFERENCES `Facility` \(`id`\)\s+ON DELETE RESTRICT/,
    );
    expect(migration).toContain('Branch_facilityId_status_createdAt_idx');
    expect(migration).not.toContain('`Branch` ADD COLUMN `tenantId`');
  });

  it('defines only the administrative Branch lifecycle and audit events', () => {
    expect(schema).toMatch(/enum BranchStatus\s*\{\s*ACTIVE\s+SUSPENDED\s+DEACTIVATED\s*\}/);
    for (const event of [
      'BRANCH_CREATED',
      'BRANCH_UPDATED',
      'BRANCH_SUSPENDED',
      'BRANCH_ACTIVATED',
      'BRANCH_DEACTIVATED',
    ]) {
      expect(schema).toContain(event);
      expect(migration).toContain(`'${event}'`);
    }
  });

  it('seeds the six Branch permissions and applies the default-role boundary', () => {
    const branchPermissions = TENANT_PERMISSION_DEFINITIONS.filter(({ code }) =>
      code.startsWith('tenant.branches.'),
    );
    expect(branchPermissions).toHaveLength(6);
    for (const { code } of branchPermissions) expect(migration).toContain(`'${code}'`);

    expect(migration).toContain('INSERT IGNORE INTO `TenantRolePermission`');
    expect(migration).toContain("`role`.`code` IN ('OWNER', 'ADMIN', 'MEMBER')");
    expect(migration).toContain("`role`.`code` IN ('OWNER', 'ADMIN')");
    expect(migration).toContain("`role`.`code` = 'OWNER'");

    const owner = DEFAULT_TENANT_ROLES.find(({ code }) => code === 'OWNER');
    const admin = DEFAULT_TENANT_ROLES.find(({ code }) => code === 'ADMIN');
    const member = DEFAULT_TENANT_ROLES.find(({ code }) => code === 'MEMBER');
    expect(owner?.permissionCodes).toContain('tenant.branches.deactivate');
    expect(admin?.permissionCodes).not.toContain('tenant.branches.deactivate');
    expect(admin?.permissionCodes).toContain('tenant.branches.activate');
    expect(member?.permissionCodes).toEqual(expect.arrayContaining(['tenant.branches.read']));
    expect(member?.permissionCodes).not.toContain('tenant.branches.create');
  });
});
