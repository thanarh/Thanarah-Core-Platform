import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TENANT_ROLES,
  TENANT_PERMISSION_DEFINITIONS,
} from '../src/tenant/tenant-authorization.constants';

const migration = readFileSync(
  'prisma/migrations/20261007120000_department_specialty_foundation/migration.sql',
  'utf8',
);
const schema = readFileSync('prisma/schema.prisma', 'utf8');
const departmentModel = schema.match(/model Department\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
const specialtyModel = schema.match(/model Specialty\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

describe('Phase 22 department and specialty schema and migration', () => {
  it('adds minimal tenant-owned catalog models with restrictive tenant keys', () => {
    for (const model of [departmentModel, specialtyModel]) {
      expect(model).toMatch(/tenantId\s+String\s+@db\.Char\(36\)/);
      expect(model).toMatch(/name\s+String\s+@db\.VarChar\(191\)/);
      expect(model).toMatch(/description\s+String\?\s+@db\.VarChar\(512\)/);
      expect(model).toMatch(/status\s+TenantCatalogStatus\s+@default\(ACTIVE\)/);
      expect(model).toMatch(/@@unique\(\[tenantId,\s*name\]\)/);
      expect(model).toMatch(/@@index\(\[tenantId,\s*status,\s*createdAt\]\)/);
      expect(model).toMatch(/onDelete: Restrict/);
      expect(model).not.toMatch(/\b(patient|appointment|schedule|facility|branch|staff)\w*/i);
    }
    expect(migration).toContain('Department_tenantId_name_key');
    expect(migration).toContain('Specialty_tenantId_name_key');
    expect(migration).toContain(
      'FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`)\n    ON DELETE RESTRICT',
    );
    expect(schema).toMatch(/departments\s+Department\[\]/);
    expect(schema).toMatch(/specialties\s+Specialty\[\]/);
  });

  it('uses one lifecycle and adds the required durable audit events', () => {
    expect(schema).toMatch(/enum TenantCatalogStatus\s*\{\s*ACTIVE\s+SUSPENDED\s+DEACTIVATED\s*\}/);
    for (const event of [
      'DEPARTMENT_CREATED',
      'DEPARTMENT_UPDATED',
      'DEPARTMENT_ACTIVATED',
      'DEPARTMENT_SUSPENDED',
      'DEPARTMENT_DEACTIVATED',
      'SPECIALTY_CREATED',
      'SPECIALTY_UPDATED',
      'SPECIALTY_ACTIVATED',
      'SPECIALTY_SUSPENDED',
      'SPECIALTY_DEACTIVATED',
    ]) {
      expect(schema).toContain(event);
      expect(migration).toContain(`'${event}'`);
    }
  });

  it('adds least-privilege tenant permissions without granting them to platform roles', () => {
    const codes = [
      'tenant.departments.read',
      'tenant.departments.manage',
      'tenant.specialties.read',
      'tenant.specialties.manage',
    ];
    for (const code of codes) {
      expect(TENANT_PERMISSION_DEFINITIONS.map(({ code: defined }) => defined)).toContain(code);
      expect(migration).toContain(`'${code}'`);
    }

    const owner = DEFAULT_TENANT_ROLES.find(({ code }) => code === 'OWNER');
    const admin = DEFAULT_TENANT_ROLES.find(({ code }) => code === 'ADMIN');
    const member = DEFAULT_TENANT_ROLES.find(({ code }) => code === 'MEMBER');
    for (const resource of ['departments', 'specialties']) {
      expect(owner?.permissionCodes).toContain(`tenant.${resource}.manage`);
      expect(admin?.permissionCodes).toContain(`tenant.${resource}.manage`);
      expect(member?.permissionCodes).toContain(`tenant.${resource}.read`);
      expect(member?.permissionCodes).not.toContain(`tenant.${resource}.manage`);
    }
    expect(migration).toContain("`role`.`code` IN ('OWNER', 'ADMIN', 'MEMBER')");
    expect(migration).toContain("`role`.`code` IN ('OWNER', 'ADMIN')");
  });

  it('keeps Department and Specialty independent from each other and other domains', () => {
    expect(departmentModel).not.toMatch(/\bspecialtyId\b|\bspecialties\b/i);
    expect(specialtyModel).not.toMatch(/\bdepartmentId\b|\bdepartments\b/i);
    expect(migration).not.toMatch(/\b(Patient|Appointment|Schedule|MedicalRecord)\b/i);
    expect(migration).not.toMatch(/\bDROP\s+(TABLE|COLUMN|INDEX)\b/i);
  });
});
