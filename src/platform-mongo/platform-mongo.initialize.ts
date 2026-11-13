import type { ClientSession, Db, Document } from 'mongodb';
import type { z } from 'zod';
import {
  PLATFORM_PERMISSION_CODES,
  PLATFORM_ROLE_CODES,
} from '../auth/platform-authorization.constants';
import type {
  PlatformPermissionCode,
  PlatformRoleCode,
} from '../auth/platform-authorization.constants';
import { TENANT_PERMISSION_DEFINITIONS } from '../tenant/tenant-authorization.constants';
import {
  documentTimestamps,
  newStableId,
  stableAssignmentId,
  platformRoleSchema,
  platformPermissionSchema,
  tenantPermissionSchema,
  platformRolePermissionSchema,
} from './platform-mongo.models';
import { parseMongoDocument } from './mongo-tenant-authorization.context';

/** Matches the historical baseline; initialization never revokes existing grants. */
const BASELINE_GRANTS: Record<PlatformRoleCode, readonly PlatformPermissionCode[]> = {
  OWNER: PLATFORM_PERMISSION_CODES,
  SUPER_ADMIN: PLATFORM_PERMISSION_CODES,
  PLATFORM_ADMIN: [
    'platform.read',
    'platform_users.read',
    'platform_users.create',
    'platform_users.update',
    'platform_users.disable',
    'platform_users.enable',
    'platform_users.assign_roles',
    'roles.read',
    'roles.assign',
    'subscriptions.read',
    'subscriptions.manage',
  ],
  SECURITY_ADMIN: [
    'sessions.read',
    'sessions.revoke',
    'audit_logs.read',
    'security_events.read',
    'security_events.update',
    'security_events.resolve',
    'system_health.read',
  ],
  SUPPORT_ADMIN: ['platform.read', 'platform_users.read', 'system_health.read'],
};

/**
 * Explicit, idempotent reference initialization, not an application-start hook.
 * Call inside one transaction after separately provisioning indexes.
 */
export async function initializeMongoReferenceData(db: Db, session: ClientSession): Promise<void> {
  const common = { ...documentTimestamps(), schemaVersion: 1 as const };
  async function ensure<T extends Document & { _id: string; code: string }>(
    name: string,
    code: string,
    schema: z.ZodType<T>,
    fields: Document = {},
  ): Promise<T> {
    const created = parseMongoDocument(schema, {
      _id: newStableId(),
      ...common,
      code,
      ...fields,
    });
    const raw = await db
      .collection<Document & { _id: string; code: string }>(name)
      .findOneAndUpdate(
        { code },
        { $setOnInsert: created },
        {
          upsert: true,
          returnDocument: 'after',
          session,
          collation: { locale: 'en', strength: 1 },
        },
      );
    return parseMongoDocument(schema, raw);
  }
  const permissionIds = new Map<string, string>();
  for (const code of PLATFORM_PERMISSION_CODES) {
    const permission = await ensure('platform_permissions', code, platformPermissionSchema);
    permissionIds.set(code, permission._id);
  }
  for (const code of PLATFORM_ROLE_CODES) {
    const role = await ensure('platform_roles', code, platformRoleSchema);
    for (const permissionCode of BASELINE_GRANTS[code]) {
      const permissionId = permissionIds.get(permissionCode);
      if (!permissionId) throw new Error('Baseline permission catalog is incomplete');
      const row = parseMongoDocument(platformRolePermissionSchema, {
        _id: stableAssignmentId(role._id, permissionId),
        roleId: role._id,
        permissionId,
      });
      await db
        .collection('platform_role_permissions')
        .updateOne(
          { roleId: role._id, permissionId },
          { $setOnInsert: row },
          { upsert: true, session },
        );
    }
  }
  for (const permission of TENANT_PERMISSION_DEFINITIONS) {
    await ensure('tenant_permissions', permission.code, tenantPermissionSchema, {
      description: permission.description,
    });
  }
}
