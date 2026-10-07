import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TENANT_ROLES,
  TENANT_PERMISSION_DEFINITIONS,
} from '../src/tenant/tenant-authorization.constants';

const migration = readFileSync(
  'prisma/migrations/20261007110000_staff_facility_branch_scope_foundation/migration.sql',
  'utf8',
);
const schema = readFileSync('prisma/schema.prisma', 'utf8');

describe('Phase 21 staff facility and branch scope schema and migration', () => {
  it('constrains facility assignments to the same tenant as staff and facility', () => {
    expect(schema).toContain('model StaffFacilityAssignment');
    expect(schema).toContain('@@id([staffId, facilityId])');
    expect(schema).toContain('@@unique([id, tenantId])');
    expect(migration).toContain(
      'FOREIGN KEY (`staffId`, `tenantId`) REFERENCES `Staff` (`id`, `tenantId`)',
    );
    expect(migration).toContain(
      'FOREIGN KEY (`facilityId`, `tenantId`) REFERENCES `Facility` (`id`, `tenantId`)',
    );
    expect(migration).toContain('PRIMARY KEY (`staffId`, `facilityId`)');
  });

  it('constrains each branch assignment to its parent facility and shared tenant', () => {
    expect(schema).toContain('model StaffBranchAssignment');
    expect(schema).toContain('facilityId String   @db.Char(36)');
    expect(schema).toContain(
      'fields: [branchId, facilityId], references: [id, facilityId], onDelete: Restrict',
    );
    expect(migration).toContain(
      'FOREIGN KEY (`branchId`, `facilityId`) REFERENCES `Branch` (`id`, `facilityId`)',
    );
    expect(migration).toContain(
      'FOREIGN KEY (`facilityId`, `tenantId`) REFERENCES `Facility` (`id`, `tenantId`)',
    );
    expect(migration).toContain('CREATE UNIQUE INDEX `Branch_id_facilityId_key`');
    expect(migration).not.toMatch(/ADD\s+`tenantId`.*`Branch`/is);
  });

  it('adds separate read and manage permissions with least-privilege default grants', () => {
    expect(TENANT_PERMISSION_DEFINITIONS.map(({ code }) => code)).toContain(
      'tenant.staff.scope.read',
    );
    expect(TENANT_PERMISSION_DEFINITIONS.map(({ code }) => code)).toContain(
      'tenant.staff.scope.manage',
    );
    expect(DEFAULT_TENANT_ROLES.find(({ code }) => code === 'MEMBER')?.permissionCodes).toContain(
      'tenant.staff.scope.read',
    );
    expect(
      DEFAULT_TENANT_ROLES.find(({ code }) => code === 'MEMBER')?.permissionCodes,
    ).not.toContain('tenant.staff.scope.manage');
    expect(migration).toContain("'tenant.staff.scope.read'");
    expect(migration).toContain("'tenant.staff.scope.manage'");
    expect(migration).toContain("`role`.`code` IN ('OWNER', 'ADMIN', 'MEMBER')");
    expect(migration).toContain("`role`.`code` IN ('OWNER', 'ADMIN')");
  });

  it('adds assignment audit event types without destructive SQL', () => {
    for (const event of [
      'STAFF_FACILITY_ASSIGNED',
      'STAFF_FACILITY_UNASSIGNED',
      'STAFF_BRANCH_ASSIGNED',
      'STAFF_BRANCH_UNASSIGNED',
    ]) {
      expect(schema).toContain(event);
      expect(migration).toContain(`'${event}'`);
    }
    expect(migration).not.toMatch(/\bDROP\s+(TABLE|COLUMN|INDEX)\b/i);
  });
});
