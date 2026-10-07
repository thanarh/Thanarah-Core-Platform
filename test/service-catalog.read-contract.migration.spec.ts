import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'prisma/migrations/20261008090000_service_catalog_read_contract/migration.sql',
  'utf8',
);
const schema = readFileSync('prisma/schema.prisma', 'utf8');
const serviceModel = schema.match(/model Service\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

describe('Phase 26 service catalog read-contract migration', () => {
  it('adds only the tenant-createdAt index needed by the unfiltered stable list order', () => {
    expect(serviceModel).toMatch(/@@index\(\[tenantId,\s*createdAt\]\)/);
    expect(migration).toMatch(
      /CREATE INDEX `Service_tenantId_createdAt_idx` ON `Service`\(`tenantId`, `createdAt`\)/,
    );
    expect(migration).not.toMatch(/\b(DROP|ALTER|CREATE TABLE)\b/i);
    expect(migration).not.toMatch(/Doctor|Staff|Department|Specialty|Facility|Branch|Patient/i);
  });
});
