import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TENANT_ROLES, TENANT_PERMISSION_DEFINITIONS } from '../src/tenant/tenant-authorization.constants';
import { PlatformDocumentConflictError } from '../src/platform-mongo/platform-mongo.errors';
import {
  documentTimestamps,
  stableAssignmentId,
} from '../src/platform-mongo/platform-mongo.models';
import { migrateTenantRoleDefaults } from '../src/platform-mongo/tenant-role-defaults.migration';

type MemoryDocument = Record<string, any>;
type MemoryCollection = {
  documents: MemoryDocument[];
  find: (filter: MemoryDocument) => { toArray: () => Promise<MemoryDocument[]> };
  insertOne: (document: MemoryDocument) => Promise<void>;
  insertMany: (documents: MemoryDocument[]) => Promise<void>;
  deleteMany: (filter: MemoryDocument) => Promise<void>;
  updateOne: (filter: MemoryDocument, update: MemoryDocument) => Promise<{ matchedCount: number }>;
  findOneAndUpdate: (
    filter: MemoryDocument,
    update: MemoryDocument,
  ) => Promise<MemoryDocument | null>;
};

function matches(document: MemoryDocument, filter: MemoryDocument): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    if (expected && typeof expected === 'object' && '$in' in expected) {
      return expected.$in.includes(document[key]);
    }
    return document[key] === expected;
  });
}

function createMemoryDatabase(seed: Record<string, MemoryDocument[]> = {}) {
  const collections = new Map<string, MemoryCollection>();
  for (const [name, documents] of Object.entries(seed)) {
    const collection: MemoryCollection = {
      documents,
      find: (filter) => ({
        toArray: async () => collection.documents.filter((document) => matches(document, filter)),
      }),
      insertOne: async (document) => {
        collection.documents.push(document);
      },
      insertMany: async (inserted) => {
        collection.documents.push(...inserted);
      },
      deleteMany: async (filter) => {
        collection.documents = collection.documents.filter((document) => !matches(document, filter));
      },
      updateOne: async (filter, update) => {
        const document = collection.documents.find((candidate) => matches(candidate, filter));
        if (!document) return { matchedCount: 0 };
        document.referenceVersion = (document.referenceVersion || 0) + 1;
        Object.assign(document, update.$set || {});
        return { matchedCount: 1 };
      },
      findOneAndUpdate: async (filter, update) => {
        const document = collection.documents.find((candidate) => matches(candidate, filter));
        if (!document) return null;
        Object.assign(document, update.$set || {});
        return { ...document };
      },
    };
    collections.set(name, collection);
  }

  return {
    collections,
    collection(name: string): MemoryCollection {
      const collection = collections.get(name);
      if (!collection) throw new Error(`Unexpected collection: ${name}`);
      return collection;
    },
  };
}

function permissionDocuments() {
  const now = new Date('2026-01-01T00:00:00.000Z');
  return TENANT_PERMISSION_DEFINITIONS.map((permission) => ({
    _id: randomUUID(),
    ...documentTimestamps(now),
    schemaVersion: 1,
    code: permission.code,
    description: permission.description,
  }));
}

describe('tenant built-in role defaults migration', () => {
  it('updates built-in grants, creates specialized roles, and can be rerun safely', async () => {
    const tenantId = randomUUID();
    const permissions = permissionDocuments();
    const permissionByCode = new Map(permissions.map((permission) => [permission.code, permission]));
    const oldDefaults = [
      { code: 'OWNER', name: 'Owner', permissions: TENANT_PERMISSION_DEFINITIONS.map(({ code }) => code) },
      { code: 'ADMIN', name: 'Admin', permissions: ['tenant.facilities.read', 'tenant.finance.read'] },
      { code: 'MEMBER', name: 'Member', permissions: ['tenant.patients.read', 'tenant.appointments.read'] },
    ];
    const roles = oldDefaults.map((definition) => ({
      _id: randomUUID(),
      ...documentTimestamps(new Date('2026-01-01T00:00:00.000Z')),
      schemaVersion: 1,
      tenantId,
      code: definition.code,
      name: definition.name,
      description: null,
      isSystemRole: true,
    }));
    const roleByCode = new Map(roles.map((role) => [role.code, role]));
    const rolePermissions = oldDefaults.flatMap((definition) =>
      definition.permissions.map((code) => ({
        _id: stableAssignmentId(roleByCode.get(definition.code)!._id, permissionByCode.get(code)!._id),
        tenantRoleId: roleByCode.get(definition.code)!._id,
        tenantPermissionId: permissionByCode.get(code)!._id,
        assignedAt: new Date('2026-01-01T00:00:00.000Z'),
      })),
    );
    const db = createMemoryDatabase({
      tenants: [{ _id: tenantId, referenceVersion: 0 }],
      tenant_roles: roles,
      tenant_permissions: permissions,
      tenant_role_permissions: rolePermissions,
      platform_audit_logs: [],
    });

    const first = await migrateTenantRoleDefaults(db as never, {} as never, tenantId);
    const persistedRoles = db.collection('tenant_roles').documents;
    const grantsByCode = new Map(
      persistedRoles.map((role) => {
        const grantLinks = db
          .collection('tenant_role_permissions')
          .documents.filter((link) => link.tenantRoleId === role._id);
        const grants = grantLinks.map((link) =>
          permissions.find((permission) => permission._id === link.tenantPermissionId)!.code,
        );
        return [role.code, { role, grants }];
      }),
    );

    expect(first.updatedPermissionRoleCodes).toEqual(['ADMIN', 'MEMBER']);
    expect(first.createdRoleCodes).toEqual(
      DEFAULT_TENANT_ROLES.filter(({ code }) => !['OWNER', 'ADMIN', 'MEMBER'].includes(code)).map(
        ({ code }) => code,
      ),
    );
    expect(grantsByCode.get('ADMIN')?.role.name).toBe('Clinic Manager');
    expect(grantsByCode.get('ADMIN')?.grants).not.toContain('tenant.finance.read');
    expect(grantsByCode.get('MEMBER')?.role.name).toBe('Viewer');
    expect(grantsByCode.get('MEMBER')?.grants).not.toContain('tenant.patients.read');
    expect(grantsByCode.get('MEMBER')?.grants).not.toContain('tenant.appointments.read');
    expect(grantsByCode.get('DOCTOR')?.grants).toContain('tenant.encounters.clinical.write');
    expect(grantsByCode.get('RECEPTIONIST')?.grants).toContain('tenant.appointments.create');
    expect(grantsByCode.get('FINANCE_PREPARER')?.grants).not.toContain('tenant.finance.issue');
    expect(grantsByCode.get('FINANCE_APPROVER')?.grants).not.toContain('tenant.finance.manage');
    expect(db.collection('platform_audit_logs').documents.length).toBeGreaterThan(0);

    const second = await migrateTenantRoleDefaults(db as never, {} as never, tenantId);
    expect(second.createdRoleCodes).toEqual([]);
    expect(second.updatedRoleCodes).toEqual([]);
    expect(second.updatedPermissionRoleCodes).toEqual([]);
  });

  it('refuses to replace a custom role that collides with a newly reserved code', async () => {
    const tenantId = randomUUID();
    const customDoctor = {
      _id: randomUUID(),
      ...documentTimestamps(new Date('2026-01-01T00:00:00.000Z')),
      schemaVersion: 1,
      tenantId,
      code: 'DOCTOR',
      name: 'Custom Doctor',
      description: null,
      isSystemRole: false,
    };
    const db = createMemoryDatabase({
      tenants: [{ _id: tenantId, referenceVersion: 0 }],
      tenant_roles: [customDoctor],
      tenant_permissions: permissionDocuments(),
      tenant_role_permissions: [],
      platform_audit_logs: [],
    });

    await expect(migrateTenantRoleDefaults(db as never, {} as never, tenantId)).rejects.toBeInstanceOf(
      PlatformDocumentConflictError,
    );
    expect(db.collection('tenant_roles').documents).toEqual([customDoctor]);
    expect(db.collection('tenant_role_permissions').documents).toEqual([]);
  });
});
