import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'prisma/migrations/20261007140000_doctor_professional_profile_foundation/migration.sql',
  'utf8',
);
const schema = readFileSync('prisma/schema.prisma', 'utf8');
const doctorModel = schema.match(/model Doctor\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

describe('Phase 24 Doctor professional profile schema and migration', () => {
  it('adds justified profile fields directly to the existing Doctor model', () => {
    expect(doctorModel).toMatch(/professionalDisplayName\s+String\?\s+@db\.VarChar\(191\)/);
    expect(doctorModel).toMatch(/professionalTitle\s+String\?\s+@db\.VarChar\(191\)/);
    expect(doctorModel).toMatch(/professionalCode\s+String\?\s+@db\.VarChar\(64\)/);
    expect(doctorModel).toMatch(/bio\s+String\?\s+@db\.VarChar\(2000\)/);
    expect(schema).not.toMatch(/model DoctorProfessionalProfile\s*\{/);
    expect(schema).not.toMatch(/yearsOfExperience/);
  });

  it('makes professional codes unique within a tenant while allowing them to be unset', () => {
    expect(doctorModel).toMatch(/@@unique\(\[tenantId,\s*professionalCode\]\)/);
    expect(migration).toContain('Doctor_tenantId_professionalCode_key');
    expect(migration).toContain('(`tenantId`, `professionalCode`)');
    expect(migration).toContain('`professionalCode` VARCHAR(64) NULL');
  });

  it('uses the existing Doctor update audit event and only adds nullable columns/indexes', () => {
    expect(schema).toContain('DOCTOR_UPDATED');
    expect(schema).not.toContain('DOCTOR_PROFILE_UPDATED');
    expect(migration).toContain('ADD COLUMN `bio` VARCHAR(2000) NULL');
    expect(migration).toContain('ADD COLUMN `professionalTitle` VARCHAR(191) NULL');
    expect(migration).not.toMatch(/\bDROP\s+(TABLE|COLUMN|INDEX)\b/i);
    expect(migration).not.toMatch(/CREATE TABLE/);
  });
});
