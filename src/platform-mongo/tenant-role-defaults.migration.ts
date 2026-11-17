import { PlatformAuditEventType } from '../common/domain-enums';
import { TENANT_PERMISSION_DEFINITIONS, DEFAULT_TENANT_ROLES } from '../tenant/tenant-authorization.constants';
import { TenantPermissionCatalogUnavailableError } from '../tenant/tenant-authorization.errors';
import type { ClientSession, Db } from 'mongodb';
import {
  PlatformDocumentConflictError,
  PlatformDocumentValidationError,
} from './platform-mongo.errors';
import { MongoTenantAuthorizationContext } from './mongo-tenant-authorization.context';
import {
  documentTimestamps,
  newStableId,
  stableAssignmentId,
  platformAuditLogSchema,
  tenantRolePermissionSchema,
  tenantRoleSchema,
} from './platform-mongo.models';
import type {
  PlatformAuditLogDocument,
  TenantPermissionDocument,
  TenantRoleDocument,
  TenantRolePermissionDocument,
} from './platform-mongo.models';

export const TENANT_ROLE_DEFAULTS_MIGRATION_ID = 'tenant-role-defaults-v2';

export type TenantRoleDefaultsMigrationResult = {
  tenantId: string;
  createdRoleCodes: string[];
  updatedRoleCodes: string[];
  updatedPermissionRoleCodes: string[];
};

/**
 * Update the tenant's built-in role catalog and grants in one transaction.
 * This is an explicit data migration; it is not called during application startup.
 */
export async function migrateTenantRoleDefaults(
  db: Db,
  session: ClientSession,
  tenantId: string,
): Promise<TenantRoleDefaultsMigrationResult> {
  const authorization = new MongoTenantAuthorizationContext(db, session);
  if (!(await authorization.touch('tenants', tenantId))) {
    throw new PlatformDocumentValidationError();
  }

  const roleCodes = DEFAULT_TENANT_ROLES.map(({ code }) => code);
  const roleCollection = db.collection<TenantRoleDocument>('tenant_roles');
  const existingRoles = await roleCollection
    .find({ tenantId, code: { $in: roleCodes } }, { session })
    .toArray();
  const existingByCode = new Map(existingRoles.map((role) => [role.code, role]));
  if (existingRoles.some((role) => !role.isSystemRole)) {
    // A custom role may have claimed a code that has since become reserved.
    throw new PlatformDocumentConflictError();
  }

  const permissionCodes = TENANT_PERMISSION_DEFINITIONS.map(({ code }) => code);
  const permissions = await db
    .collection<TenantPermissionDocument>('tenant_permissions')
    .find({ code: { $in: permissionCodes } }, { session })
    .toArray();
  if (permissions.length !== permissionCodes.length) {
    throw new TenantPermissionCatalogUnavailableError();
  }
  const permissionByCode = new Map(permissions.map((permission) => [permission.code, permission]));
  const links = db.collection<TenantRolePermissionDocument>('tenant_role_permissions');
  const createdRoleCodes: string[] = [];
  const updatedRoleCodes: string[] = [];
  const updatedPermissionRoleCodes: string[] = [];
  const now = new Date();

  async function writeAudit(
    eventType:
      | typeof PlatformAuditEventType.TENANT_ROLE_CREATED
      | typeof PlatformAuditEventType.TENANT_ROLE_UPDATED
      | typeof PlatformAuditEventType.TENANT_ROLE_PERMISSIONS_UPDATED,
    role: TenantRoleDocument,
    metadata: Record<string, string | number | boolean | null>,
  ): Promise<void> {
    const record = platformAuditLogSchema.parse({
      _id: newStableId(),
      eventType,
      actorUserId: null,
      subjectUserId: null,
      subjectTenantId: tenantId,
      sessionId: null,
      requestId: TENANT_ROLE_DEFAULTS_MIGRATION_ID,
      ipAddress: null,
      userAgent: 'migration:tenant-role-defaults-v2',
      occurredAt: now,
      metadata: {
        migrationId: TENANT_ROLE_DEFAULTS_MIGRATION_ID,
        roleId: role._id,
        roleCode: role.code,
        ...metadata,
      },
    }) as PlatformAuditLogDocument;
    await db.collection<PlatformAuditLogDocument>('platform_audit_logs').insertOne(record, {
      session,
    });
  }

  for (const definition of DEFAULT_TENANT_ROLES) {
    let role = existingByCode.get(definition.code);
    const isNew = !role;
    let previousPermissionCodes: string[] = [];
    let permissionsChanged = true;

    if (role) {
      role = tenantRoleSchema.parse(role);
      if (!(await authorization.touch('tenant_roles', role._id, { tenantId }))) {
        throw new PlatformDocumentConflictError();
      }
      const oldLinks = await links.find({ tenantRoleId: role._id }, { session }).toArray();
      if (oldLinks.length) {
        const oldPermissions = await db
          .collection<TenantPermissionDocument>('tenant_permissions')
          .find({ _id: { $in: oldLinks.map((link) => link.tenantPermissionId) } }, { session })
          .toArray();
        const oldPermissionById = new Map(oldPermissions.map((permission) => [permission._id, permission]));
        previousPermissionCodes = oldLinks.map((link) => {
          const permission = oldPermissionById.get(link.tenantPermissionId);
          if (!permission) throw new PlatformDocumentValidationError();
          return permission.code;
        });
      }
      const before = previousPermissionCodes.slice().sort();
      const after = [...definition.permissionCodes].sort();
      permissionsChanged = before.join(',') !== after.join(',');
    } else {
      role = tenantRoleSchema.parse({
        _id: newStableId(),
        ...documentTimestamps(now),
        schemaVersion: 1,
        tenantId,
        code: definition.code,
        name: definition.name,
        description: definition.description,
        isSystemRole: true,
      });
      await roleCollection.insertOne(role, { session });
      createdRoleCodes.push(definition.code);
    }

    const metadataChanged = isNew || role.name !== definition.name ||
      role.description !== definition.description || !role.isSystemRole;
    if (!isNew && (metadataChanged || permissionsChanged)) {
      const result = await roleCollection.findOneAndUpdate(
        { _id: role._id, tenantId, isSystemRole: true },
        { $set: { name: definition.name, description: definition.description, updatedAt: now } },
        { session, returnDocument: 'after' },
      );
      if (!result) throw new PlatformDocumentConflictError();
      role = tenantRoleSchema.parse(result);
    }

    if (permissionsChanged) {
      await links.deleteMany({ tenantRoleId: role._id }, { session });
      const rolePermissions = definition.permissionCodes.map((code) => {
        const permission = permissionByCode.get(code);
        if (!permission) throw new TenantPermissionCatalogUnavailableError();
        return tenantRolePermissionSchema.parse({
          _id: stableAssignmentId(role!._id, permission._id),
          tenantRoleId: role!._id,
          tenantPermissionId: permission._id,
          assignedAt: now,
        });
      });
      if (rolePermissions.length) await links.insertMany(rolePermissions, { session });
      if (!isNew) updatedPermissionRoleCodes.push(definition.code);
    }

    if (!isNew && metadataChanged) updatedRoleCodes.push(definition.code);
    if (isNew) {
      await writeAudit(PlatformAuditEventType.TENANT_ROLE_CREATED, role, {
        isSystemRole: true,
        permissionCodes: definition.permissionCodes.join(','),
      });
    } else {
      if (metadataChanged) {
        await writeAudit(PlatformAuditEventType.TENANT_ROLE_UPDATED, role, {
          name: definition.name,
          description: definition.description,
        });
      }
      if (permissionsChanged) {
        await writeAudit(PlatformAuditEventType.TENANT_ROLE_PERMISSIONS_UPDATED, role, {
          previousPermissionCodes: previousPermissionCodes.join(','),
          permissionCodes: definition.permissionCodes.join(','),
        });
      }
    }
  }

  return {
    tenantId,
    createdRoleCodes,
    updatedRoleCodes,
    updatedPermissionRoleCodes,
  };
}
