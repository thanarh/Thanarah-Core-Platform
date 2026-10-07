import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TENANT_ROLES,
  TENANT_PERMISSION_DEFINITIONS,
} from '../src/tenant/tenant-authorization.constants';
import { PatientStatus } from '../src/tenant/patient.model';

const migration = readFileSync(
  'prisma/migrations/20261008100000_tenant_patient_foundation/migration.sql',
  'utf8',
);
const schema = readFileSync('prisma/schema.prisma', 'utf8');
const repositorySource = readFileSync('src/tenant/patient.repository.ts', 'utf8');
const patientModel = schema.match(/model Patient\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

describe('Patient tenant-storage boundary', () => {
  it('retains the central Patient schema as legacy while the runtime leaves it unused', () => {
    expect(patientModel).toMatch(/tenantId\s+String\s+@db\.Char\(36\)/);
    expect(patientModel).toMatch(/patientNumber\s+String\s+@db\.VarChar\(64\)/);
    expect(patientModel).toMatch(/firstName\s+String\s+@db\.VarChar\(191\)/);
    expect(patientModel).toMatch(/middleName\s+String\?\s+@db\.VarChar\(191\)/);
    expect(patientModel).toMatch(/lastName\s+String\s+@db\.VarChar\(191\)/);
    expect(patientModel).toMatch(/preferredName\s+String\?\s+@db\.VarChar\(191\)/);
    expect(patientModel).toMatch(/dateOfBirth\s+DateTime\?\s+@db\.Date/);
    expect(patientModel).toMatch(/status\s+PatientStatus\s+@default\(ACTIVE\)/);
    expect(patientModel).toMatch(/@@unique\(\[tenantId,\s*patientNumber\]\)/);
    expect(patientModel).toMatch(/tenant\s+Tenant\s+@relation\([^)]*onDelete:\s*Restrict/);
    expect(schema).toMatch(/patients\s+Patient\[\]/);

    for (const forbidden of [
      'PlatformUser',
      'TenantMembership',
      'Staff',
      'Doctor',
      'Facility',
      'Branch',
      'Service',
      'Appointment',
      'Visit',
      'Diagnosis',
      'Prescription',
      'Subscription',
    ]) {
      expect(patientModel).not.toMatch(new RegExp(`\\b${forbidden}\\b`, 'i'));
    }

    expect(repositorySource).not.toMatch(/@prisma\/client|PrismaService|prisma\.patient/i);
    expect(repositorySource).toContain('TrustedTenantContext');
    expect(repositorySource).toContain('TenantStorageResolver');
  });

  it('keeps the ACTIVE/INACTIVE lifecycle and required audit events', () => {
    expect(Object.values(PatientStatus)).toEqual(['ACTIVE', 'INACTIVE']);

    for (const event of ['PATIENT_CREATED', 'PATIENT_UPDATED', 'PATIENT_STATUS_CHANGED']) {
      expect(schema).toContain(event);
      expect(migration).toContain(`'${event}'`);
    }
    expect(migration).toContain('Patient_tenantId_patientNumber_key');
    expect(migration).toContain('Patient_tenantId_status_createdAt_idx');
    expect(migration).toContain('Patient_tenantId_createdAt_idx');
    expect(migration).toContain('Patient_tenantId_fkey');
  });

  it('keeps independent least-privilege patient permissions for the default roles', () => {
    const permissionCodes = TENANT_PERMISSION_DEFINITIONS.map(({ code }) => code);
    expect(permissionCodes).toContain('tenant.patients.read');
    expect(permissionCodes).toContain('tenant.patients.manage');
    expect(migration).toContain("'tenant.patients.read'");
    expect(migration).toContain("'tenant.patients.manage'");

    const owner = DEFAULT_TENANT_ROLES.find(({ code }) => code === 'OWNER');
    const admin = DEFAULT_TENANT_ROLES.find(({ code }) => code === 'ADMIN');
    const member = DEFAULT_TENANT_ROLES.find(({ code }) => code === 'MEMBER');
    expect(owner?.permissionCodes).toContain('tenant.patients.manage');
    expect(admin?.permissionCodes).toContain('tenant.patients.manage');
    expect(member?.permissionCodes).toContain('tenant.patients.read');
    expect(member?.permissionCodes).not.toContain('tenant.patients.manage');
    expect(migration).toContain("`role`.`code` IN ('OWNER', 'ADMIN', 'MEMBER')");
    expect(migration).toContain("`role`.`code` IN ('OWNER', 'ADMIN')");
  });

  it('leaves the Phase 27 migration additive and does not add a table-drop migration', () => {
    expect(migration).not.toMatch(/\bDROP\s+(TABLE|COLUMN|INDEX)\b/i);
    expect(migration).not.toMatch(
      /\bCREATE TABLE\s+`?(Doctor|Staff|Department|Specialty|Facility|Branch|Appointment|Visit|Billing|Insurance|Subscription)`?/i,
    );
    expect(
      existsSync('prisma/migrations/20261008110000_patient_tenant_storage_boundary/migration.sql'),
    ).toBe(false);
  });
});
