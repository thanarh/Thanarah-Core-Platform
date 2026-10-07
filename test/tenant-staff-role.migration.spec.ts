import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'prisma/migrations/20261007100000_staff_role_assignment_foundation/migration.sql',
  'utf8',
);
const schema = readFileSync('prisma/schema.prisma', 'utf8');

describe('Phase 20 staff role assignment schema and migration', () => {
  it('models a tenant-qualified, unique staff-to-role assignment', () => {
    expect(schema).toContain('model StaffRoleAssignment');
    expect(schema).toContain('@@id([staffId, tenantRoleId])');
    expect(schema).toContain(
      'fields: [staffId, tenantId], references: [id, tenantId], onDelete: Restrict',
    );
    expect(schema).toContain(
      'fields: [tenantRoleId, tenantId], references: [id, tenantId], onDelete: Restrict',
    );
    expect(migration).toContain('PRIMARY KEY (`staffId`, `tenantRoleId`)');
    expect(migration).toContain('StaffRoleAssignment_staffId_tenantId_fkey');
    expect(migration).toContain('StaffRoleAssignment_tenantRoleId_tenantId_fkey');
  });

  it('adds only the staff role permission definitions and default grants', () => {
    expect(migration).toContain("'tenant.staff.roles.read'");
    expect(migration).toContain("'tenant.staff.roles.manage'");
    expect(migration).toContain("`role`.`code` IN ('OWNER', 'ADMIN', 'MEMBER')");
    expect(migration).toContain("`role`.`code` IN ('OWNER', 'ADMIN')");
    expect(migration).not.toMatch(/\bDROP\s+(TABLE|COLUMN|INDEX)\b/i);
  });

  it('adds auditable assignment and removal event types', () => {
    expect(schema).toMatch(/STAFF_ROLE_ASSIGNED\s+STAFF_ROLE_REMOVED/);
    expect(migration).toContain("'STAFF_ROLE_ASSIGNED'");
    expect(migration).toContain("'STAFF_ROLE_REMOVED'");
  });
});
