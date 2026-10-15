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

  it('grants only appointment read to MEMBER and appointment mutations to OWNER and ADMIN', () => {
    const owner = DEFAULT_TENANT_ROLES.find(({ code }) => code === 'OWNER');
    const admin = DEFAULT_TENANT_ROLES.find(({ code }) => code === 'ADMIN');
    const member = DEFAULT_TENANT_ROLES.find(({ code }) => code === 'MEMBER');
    expect(owner?.permissionCodes).toEqual(expect.arrayContaining(appointmentPermissions));
    expect(admin?.permissionCodes).toEqual(expect.arrayContaining(appointmentPermissions));
    expect(member?.permissionCodes).toContain('tenant.appointments.read');
    for (const permission of appointmentPermissions.slice(1)) {
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
