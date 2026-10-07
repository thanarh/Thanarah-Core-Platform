import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TENANT_ROLES,
  TENANT_PERMISSION_DEFINITIONS,
} from '../src/tenant/tenant-authorization.constants';

const migration = readFileSync(
  'prisma/migrations/20261007130000_doctor_foundation/migration.sql',
  'utf8',
);
const schema = readFileSync('prisma/schema.prisma', 'utf8');
const doctorModel = schema.match(/model Doctor\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
const departmentAssignmentModel =
  schema.match(/model DoctorDepartmentAssignment\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
const specialtyAssignmentModel =
  schema.match(/model DoctorSpecialtyAssignment\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

describe('Phase 23 Doctor schema and migration', () => {
  it('adds one tenant-owned Doctor profile per Staff with a Staff-consistent lifecycle', () => {
    expect(doctorModel).toMatch(/tenantId\s+String\s+@db\.Char\(36\)/);
    expect(doctorModel).toMatch(/staffId\s+String\s+@db\.Char\(36\)/);
    expect(doctorModel).toMatch(/status\s+StaffStatus\s+@default\(ACTIVE\)/);
    expect(doctorModel).toMatch(/@@unique\(\[staffId,\s*tenantId\]\)/);
    expect(doctorModel).toMatch(/staff\s+Staff\s+@relation\(fields: \[staffId,\s*tenantId\]/);
    expect(doctorModel).toMatch(/onDelete: Restrict/);
    expect(doctorModel).not.toMatch(
      /\b(password|token|membershipId|platformUserId|roleId|permission|license|diagnosis|prescription)\b/i,
    );
    expect(migration).toContain('Doctor_staffId_tenantId_key');
    expect(migration).toContain(
      'FOREIGN KEY (`staffId`, `tenantId`) REFERENCES `Staff` (`id`, `tenantId`)',
    );
  });

  it('models multi-department and multi-specialty relationships with tenant-qualified restrictive keys', () => {
    for (const model of [departmentAssignmentModel, specialtyAssignmentModel]) {
      expect(model).toMatch(/tenantId\s+String\s+@db\.Char\(36\)/);
      expect(model).toMatch(/@@id\(\[doctorId,/);
      expect(model).toMatch(/doctor\s+Doctor\s+@relation\(fields: \[doctorId,\s*tenantId\]/);
      expect(model).toMatch(/onDelete: Restrict/);
    }
    expect(departmentAssignmentModel).toMatch(
      /department\s+Department\s+@relation\(fields: \[departmentId,\s*tenantId\]/,
    );
    expect(specialtyAssignmentModel).toMatch(
      /specialty\s+Specialty\s+@relation\(fields: \[specialtyId,\s*tenantId\]/,
    );
    expect(migration).toContain(
      'FOREIGN KEY (`doctorId`, `tenantId`) REFERENCES `Doctor` (`id`, `tenantId`)',
    );
    expect(migration).toContain(
      'FOREIGN KEY (`departmentId`, `tenantId`) REFERENCES `Department` (`id`, `tenantId`)',
    );
    expect(migration).toContain(
      'FOREIGN KEY (`specialtyId`, `tenantId`) REFERENCES `Specialty` (`id`, `tenantId`)',
    );
    expect(schema).not.toMatch(/DoctorFacilityAssignment|DoctorBranchAssignment/);
    expect(migration).not.toMatch(/DoctorFacilityAssignment|DoctorBranchAssignment/);
  });

  it('adds the complete Doctor and assignment audit event set', () => {
    for (const event of [
      'DOCTOR_CREATED',
      'DOCTOR_UPDATED',
      'DOCTOR_ACTIVATED',
      'DOCTOR_SUSPENDED',
      'DOCTOR_DEACTIVATED',
      'DOCTOR_DEPARTMENT_ASSIGNED',
      'DOCTOR_DEPARTMENT_UNASSIGNED',
      'DOCTOR_SPECIALTY_ASSIGNED',
      'DOCTOR_SPECIALTY_UNASSIGNED',
    ]) {
      expect(schema).toContain(event);
      expect(migration).toContain(`'${event}'`);
    }
  });

  it('adds role-driven Doctor read/manage permissions without granting permissions to Doctors', () => {
    const codes = ['tenant.doctors.read', 'tenant.doctors.manage'];
    for (const code of codes) {
      expect(TENANT_PERMISSION_DEFINITIONS.map(({ code: defined }) => defined)).toContain(code);
      expect(migration).toContain(`'${code}'`);
    }
    const owner = DEFAULT_TENANT_ROLES.find(({ code }) => code === 'OWNER');
    const admin = DEFAULT_TENANT_ROLES.find(({ code }) => code === 'ADMIN');
    const member = DEFAULT_TENANT_ROLES.find(({ code }) => code === 'MEMBER');
    expect(owner?.permissionCodes).toEqual(expect.arrayContaining(codes));
    expect(admin?.permissionCodes).toEqual(expect.arrayContaining(codes));
    expect(member?.permissionCodes).toContain('tenant.doctors.read');
    expect(member?.permissionCodes).not.toContain('tenant.doctors.manage');
    expect(migration).toContain("`role`.`code` IN ('OWNER', 'ADMIN', 'MEMBER')");
    expect(migration).toContain("`role`.`code` IN ('OWNER', 'ADMIN')");
  });

  it('keeps the migration additive and excludes later clinical or business modules', () => {
    expect(migration).not.toMatch(/\bDROP\s+(TABLE|COLUMN|INDEX)\b/i);
    expect(migration).not.toMatch(
      /\b(Patient|Appointment|MedicalRecord|Prescription|Diagnosis)\b/i,
    );
    expect(schema).not.toMatch(
      /model (Appointment|MedicalRecord|Prescription|Diagnosis|DoctorFacilityAssignment|DoctorBranchAssignment)\s*\{/,
    );
    expect(migration).not.toMatch(/MongoDB|CREATE COLLECTION/i);
  });
});
