import type { Db, IndexDescription } from 'mongodb';
import { PlatformMongoUnavailableError } from './platform-mongo.errors';

export const PLATFORM_MONGO_INDEXES: Readonly<Record<string, readonly IndexDescription[]>> = {
  platform_users: [
    {
      key: { email: 1 },
      name: 'ux_platform_users_email',
      unique: true,
      collation: { locale: 'en', strength: 1 },
    },
    { key: { status: 1 }, name: 'ix_platform_users_status' },
  ],
  tenants: [
    { key: { slug: 1 }, name: 'ux_tenants_slug', unique: true },
    { key: { status: 1 }, name: 'ix_tenants_status' },
    { key: { status: 1, createdAt: 1 }, name: 'ix_tenants_status_created' },
  ],
  tenant_memberships: [
    { key: { tenantId: 1, platformUserId: 1 }, name: 'ux_membership_tenant_user', unique: true },
    { key: { _id: 1, tenantId: 1 }, name: 'ux_membership_id_tenant', unique: true },
    {
      key: { _id: 1, tenantId: 1, platformUserId: 1 },
      name: 'ux_membership_id_tenant_user',
      unique: true,
    },
    { key: { tenantId: 1, status: 1, createdAt: 1 }, name: 'ix_membership_tenant_status' },
    { key: { platformUserId: 1, status: 1 }, name: 'ix_membership_user_status' },
  ],
  platform_roles: [{ key: { code: 1 }, name: 'ux_platform_roles_code', unique: true }],
  platform_permissions: [{ key: { code: 1 }, name: 'ux_platform_permissions_code', unique: true }],
  platform_features: [
    {
      key: { key: 1 },
      name: 'ux_platform_features_key',
      unique: true,
      collation: { locale: 'en', strength: 1 },
    },
    { key: { status: 1, createdAt: -1, _id: -1 }, name: 'ix_platform_features_status_created' },
  ],
  platform_plans: [
    {
      key: { key: 1 },
      name: 'ux_platform_plans_key',
      unique: true,
      collation: { locale: 'en', strength: 1 },
    },
    { key: { status: 1, createdAt: -1, _id: -1 }, name: 'ix_platform_plans_status_created' },
  ],
  platform_plan_features: [
    {
      key: { planId: 1, featureId: 1 },
      name: 'ux_platform_plan_features_pair',
      unique: true,
    },
    { key: { featureId: 1, createdAt: 1 }, name: 'ix_platform_plan_features_feature_created' },
    {
      key: { planId: 1, createdAt: 1, featureId: 1 },
      name: 'ix_platform_plan_features_plan_created',
    },
  ],
  platform_user_roles: [
    { key: { userId: 1, roleId: 1 }, name: 'ux_platform_user_role', unique: true },
    { key: { roleId: 1, userId: 1 }, name: 'ix_platform_role_users' },
  ],
  platform_role_permissions: [
    { key: { roleId: 1, permissionId: 1 }, name: 'ux_platform_role_permission', unique: true },
    { key: { permissionId: 1, roleId: 1 }, name: 'ix_platform_permission_roles' },
  ],
  platform_sessions: [
    { key: { refreshTokenHash: 1 }, name: 'ux_platform_session_refresh_hash', unique: true },
    { key: { userId: 1, status: 1 }, name: 'ix_platform_session_user_status' },
    { key: { tokenFamilyId: 1 }, name: 'ix_platform_session_family' },
    { key: { expiresAt: 1 }, name: 'ix_platform_session_expiry' },
  ],
  platform_refresh_token_history: [
    { key: { tokenHash: 1 }, name: 'ux_refresh_history_token_hash', unique: true },
    { key: { sessionId: 1 }, name: 'ix_refresh_history_session' },
    { key: { tokenFamilyId: 1 }, name: 'ix_refresh_history_family' },
    { key: { expiresAt: 1 }, name: 'ix_refresh_history_expiry' },
  ],
};

export async function provisionPlatformMongoIndexes(db: Db): Promise<void> {
  try {
    for (const [collectionName, indexes] of Object.entries(PLATFORM_MONGO_INDEXES)) {
      await db.collection(collectionName).createIndexes([...indexes]);
    }
    await verifyPlatformMongoIndexes(db);
  } catch {
    throw new PlatformMongoUnavailableError();
  }
}

export async function verifyPlatformMongoIndexes(db: Db): Promise<void> {
  try {
    for (const [collectionName, required] of Object.entries(PLATFORM_MONGO_INDEXES)) {
      const actual = await db.collection(collectionName).listIndexes().toArray();
      for (const expected of required) {
        const found = actual.find((index) => index.name === expected.name);
        if (
          !found ||
          JSON.stringify(found.key) !== JSON.stringify(expected.key) ||
          Boolean(found.unique) !== Boolean(expected.unique) ||
          (expected.collation &&
            (found.collation?.locale !== expected.collation.locale ||
              found.collation?.strength !== expected.collation.strength)) ||
          (expected.partialFilterExpression &&
            JSON.stringify(found.partialFilterExpression) !==
              JSON.stringify(expected.partialFilterExpression))
        ) {
          throw new PlatformMongoUnavailableError();
        }
      }
    }
  } catch {
    throw new PlatformMongoUnavailableError();
  }
}
