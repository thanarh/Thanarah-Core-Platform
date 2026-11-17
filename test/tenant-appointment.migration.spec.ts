import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TENANT_ROLES,
  TENANT_PERMISSION_DEFINITIONS,
} from '../src/tenant/tenant-authorization.constants';

const migration = readFileSync(
  'prisma/migrations/20261015120000_tenant_appointment_scheduling/migration.sql',
  'utf8',
);
const policyMigration = readFileSync(
  'prisma/migrations/20261015130000_facility_scheduling_policy/migration.sql',
  'utf8',
);
const schema = readFileSync('prisma/schema.prisma', 'utf8');
const appointmentAuditEvents = [
  'APPOINTMENT_CREATED',
  'APPOINTMENT_UPDATED',
  'APPOINTMENT_RESCHEDULED',
  'APPOINTMENT_CANCELLED',
];
const appointmentPermissions = [
  'tenant.appointments.read',
  'tenant.appointments.create',
  'tenant.appointments.update',
  'tenant.appointments.reschedule',
  'tenant.appointments.cancel',
];

describe('Tenant appointment permission and audit migration', () => {
  it('registers dedicated appointment permissions and status audit events', () => {
    const registeredPermissions = TENANT_PERMISSION_DEFINITIONS.map(({ code }) => code);
    for (const permission of appointmentPermissions) {
      expect(registeredPermissions).toContain(permission);
      expect(migration).toContain(`'${permission}'`);
    }
    for (const event of appointmentAuditEvents) {
      expect(schema).toContain(event);
      expect(migration).toContain(`'${event}'`);
    }
  });

  it('limits appointment mutations to operations roles, not the generic viewer', () => {
    const owner = DEFAULT_TENANT_ROLES.find(({ code }) => code === 'OWNER');
    const admin = DEFAULT_TENANT_ROLES.find(({ code }) => code === 'ADMIN');
    const member = DEFAULT_TENANT_ROLES.find(({ code }) => code === 'MEMBER');
    const receptionist = DEFAULT_TENANT_ROLES.find(({ code }) => code === 'RECEPTIONIST');
    const doctor = DEFAULT_TENANT_ROLES.find(({ code }) => code === 'DOCTOR');
    expect(owner?.permissionCodes).toEqual(expect.arrayContaining(appointmentPermissions));
    expect(admin?.permissionCodes).toEqual(expect.arrayContaining(appointmentPermissions));
    expect(receptionist?.permissionCodes).toEqual(expect.arrayContaining(appointmentPermissions));
    expect(doctor?.permissionCodes).toContain('tenant.appointments.read');
    expect(member?.permissionCodes).not.toContain('tenant.appointments.read');
    for (const permission of appointmentPermissions) {
      expect(member?.permissionCodes).not.toContain(permission);
    }
    expect(migration).toContain("`role`.`code` IN ('OWNER', 'ADMIN', 'MEMBER')");
    expect(migration).toContain("`role`.`code` IN ('OWNER', 'ADMIN')");
  });

  it('does not add appointment records to the central Prisma control plane', () => {
    expect(schema).not.toMatch(/model Appointment\s*\{/u);
    expect(migration).not.toMatch(/\bCREATE\s+TABLE\s+`?Appointment`?/iu);
    expect(migration).not.toMatch(/\bALTER\s+TABLE\s+`?Appointment`?/iu);
  });
});

describe('Facility scheduling policy migration', () => {
  const policyPermission = 'tenant.appointments.policy.manage';
  const policyAuditEvents = [
    'SCHEDULING_POLICY_CREATED',
    'SCHEDULING_POLICY_UPDATED',
    'SCHEDULING_POLICY_ACTIVATED',
    'SCHEDULING_POLICY_DEACTIVATED',
  ];

  it('creates tenant/facility-scoped policy and immutable revision tables', () => {
    expect(policyMigration).toContain('CREATE TABLE `FacilitySchedulingPolicy`');
    expect(policyMigration).toContain('CREATE TABLE `FacilitySchedulingPolicyRevision`');
    expect(policyMigration).toContain('FacilitySchedulingPolicy_facilityId_tenantId_fkey');
    expect(policyMigration).toContain('FacilitySchedulingPolicyRevision_policyId_tenantId_fkey');
    expect(schema).toContain('model FacilitySchedulingPolicy {');
    expect(schema).toContain('model FacilitySchedulingPolicyRevision {');
  });

  it('registers policy audit events and grants policy management only to tenant owners and admins', () => {
    const registeredPermissions = TENANT_PERMISSION_DEFINITIONS.map(({ code }) => code);
    expect(registeredPermissions).toContain(policyPermission);
    expect(policyMigration).toContain(`'${policyPermission}'`);
    for (const event of policyAuditEvents) {
      expect(schema).toContain(event);
      expect(policyMigration).toContain(`'${event}'`);
    }
    expect(policyMigration).toContain("`role`.`code` IN ('OWNER', 'ADMIN')");
    expect(policyMigration).not.toContain("`role`.`code` IN ('OWNER', 'ADMIN', 'MEMBER')");

    const owner = DEFAULT_TENANT_ROLES.find(({ code }) => code === 'OWNER');
    const admin = DEFAULT_TENANT_ROLES.find(({ code }) => code === 'ADMIN');
    const member = DEFAULT_TENANT_ROLES.find(({ code }) => code === 'MEMBER');
    expect(owner?.permissionCodes).toContain(policyPermission);
    expect(admin?.permissionCodes).toContain(policyPermission);
    expect(member?.permissionCodes).not.toContain(policyPermission);
  });
});
