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
  facilities: [
    { key: { _id: 1, tenantId: 1 }, name: 'ux_facility_id_tenant', unique: true },
    {
      key: { tenantId: 1, status: 1, createdAt: -1, _id: -1 },
      name: 'ix_facility_tenant_status_created',
    },
  ],
  tenant_staff: [
    { key: { _id: 1, tenantId: 1 }, name: 'ux_tenant_staff_id_tenant', unique: true },
    { key: { tenantId: 1, userId: 1 }, name: 'ux_tenant_staff_tenant_user', unique: true },
    {
      key: { membershipId: 1, tenantId: 1, userId: 1 },
      name: 'ux_tenant_staff_membership_tenant_user',
      unique: true,
    },
    {
      key: { tenantId: 1, status: 1, createdAt: -1, _id: -1 },
      name: 'ix_tenant_staff_tenant_status_created',
    },
    { key: { userId: 1, status: 1 }, name: 'ix_tenant_staff_user_status' },
  ],
  branches: [
    { key: { _id: 1, facilityId: 1 }, name: 'ux_branch_id_facility', unique: true },
    {
      key: { facilityId: 1, status: 1, createdAt: -1, _id: -1 },
      name: 'ix_branch_facility_status_created',
    },
  ],
  departments: [
    { key: { _id: 1, tenantId: 1 }, name: 'ux_department_id_tenant', unique: true },
    {
      key: { tenantId: 1, name: 1 },
      name: 'ux_department_tenant_name',
      unique: true,
      collation: { locale: 'en', strength: 1 },
    },
    {
      key: { tenantId: 1, status: 1, createdAt: -1, _id: -1 },
      name: 'ix_department_tenant_status_created',
    },
  ],
  specialties: [
    { key: { _id: 1, tenantId: 1 }, name: 'ux_specialty_id_tenant', unique: true },
    {
      key: { tenantId: 1, name: 1 },
      name: 'ux_specialty_tenant_name',
      unique: true,
      collation: { locale: 'en', strength: 1 },
    },
    {
      key: { tenantId: 1, status: 1, createdAt: -1, _id: -1 },
      name: 'ix_specialty_tenant_status_created',
    },
  ],
  services: [
    { key: { _id: 1, tenantId: 1 }, name: 'ux_service_id_tenant', unique: true },
    {
      key: { tenantId: 1, name: 1 },
      name: 'ux_service_tenant_name',
      unique: true,
      collation: { locale: 'en', strength: 1 },
    },
    {
      key: { tenantId: 1, code: 1 },
      name: 'ux_service_tenant_code',
      unique: true,
      collation: { locale: 'en', strength: 1 },
      partialFilterExpression: { code: { $type: 'string' } },
    },
    { key: { tenantId: 1, createdAt: -1, _id: -1 }, name: 'ix_service_tenant_created' },
    {
      key: { tenantId: 1, status: 1, createdAt: -1, _id: -1 },
      name: 'ix_service_tenant_status_created',
    },
  ],
  clinic_website_sites: [
    {
      key: { 'published.slug': 1 },
      name: 'ux_clinic_website_published_slug',
      unique: true,
      partialFilterExpression: { 'published.slug': { $type: 'string' } },
    },
    { key: { tenantId: 1 }, name: 'ux_clinic_website_tenant', unique: true },
  ],
  clinic_website_versions: [
    { key: { tenantId: 1, version: -1 }, name: 'ux_clinic_website_version', unique: true },
  ],
  subscriptions: [
    {
      key: { tenantId: 1, status: 1, startsAt: -1, _id: -1 },
      name: 'ix_subscription_tenant_status_start',
    },
    { key: { tenantId: 1, status: 1, endsAt: 1, startsAt: 1 }, name: 'ix_subscription_overlap' },
    { key: { tenantId: 1, createdAt: -1, _id: -1 }, name: 'ix_subscription_tenant_created' },
    { key: { planId: 1, createdAt: -1, _id: -1 }, name: 'ix_subscription_plan_created' },
  ],
  tenant_roles: [
    { key: { _id: 1, tenantId: 1 }, name: 'ux_tenant_role_id_tenant', unique: true },
    {
      key: { tenantId: 1, code: 1 },
      name: 'ux_tenant_role_tenant_code',
      unique: true,
      collation: { locale: 'en', strength: 1 },
    },
    { key: { tenantId: 1, isSystemRole: -1, code: 1 }, name: 'ix_tenant_role_list' },
  ],
  tenant_permissions: [
    {
      key: { code: 1 },
      name: 'ux_tenant_permission_code',
      unique: true,
      collation: { locale: 'en', strength: 1 },
    },
  ],
  tenant_role_permissions: [
    {
      key: { tenantRoleId: 1, tenantPermissionId: 1 },
      name: 'ux_tenant_role_permission',
      unique: true,
    },
    { key: { tenantPermissionId: 1 }, name: 'ix_tenant_permission_roles' },
  ],
  tenant_membership_roles: [
    { key: { membershipId: 1, tenantRoleId: 1 }, name: 'ux_tenant_membership_role', unique: true },
    { key: { tenantId: 1, tenantRoleId: 1 }, name: 'ix_tenant_role_memberships' },
  ],
  tenant_staff_roles: [
    { key: { staffId: 1, tenantRoleId: 1 }, name: 'ux_tenant_staff_role', unique: true },
    { key: { tenantId: 1, staffId: 1, assignedAt: 1 }, name: 'ix_tenant_staff_roles' },
  ],
  tenant_staff_scope_assignments: [
    {
      key: { tenantId: 1, staffId: 1, scopeType: 1, scopeId: 1 },
      name: 'ux_staff_scope_assignment',
      unique: true,
    },
    {
      key: { tenantId: 1, staffId: 1, assignedAt: 1, scopeId: 1 },
      name: 'ix_staff_scope_assignment_list',
    },
  ],
  doctors: [
    { key: { tenantId: 1, staffId: 1 }, name: 'ux_doctor_staff', unique: true },
    {
      key: { tenantId: 1, professionalCode: 1 },
      name: 'ux_doctor_professional_code',
      unique: true,
      partialFilterExpression: { professionalCode: { $type: 'string' } },
      collation: { locale: 'en', strength: 1 },
    },
    { key: { tenantId: 1, status: 1, createdAt: -1, _id: -1 }, name: 'ix_doctor_list' },
  ],
  tenant_storage_targets: [
    {
      key: { tenantId: 1 },
      name: 'ux_active_primary_tenant_target',
      unique: true,
      partialFilterExpression: { provider: 'MONGODB', status: 'ACTIVE', isPrimary: true },
    },
    {
      key: { tenantId: 1, provider: 1, status: 1, isPrimary: 1, createdAt: 1 },
      name: 'ix_tenant_target_routing',
    },
    { key: { connectionReference: 1, databaseName: 1 }, name: 'ux_target_database', unique: true },
  ],
  encounter_operations: [
    { key: { historyEventId: 1 }, name: 'ux_encounter_operation_history', unique: true },
    {
      key: { tenantId: 1, auditDeliveryStatus: 1, createdAt: 1 },
      name: 'ix_encounter_operation_reconcile',
    },
    { key: { auditDeliveryStatus: 1, createdAt: 1 }, name: 'ix_encounter_operation_pending' },
  ],
  subscription_transfers: [
    {
      key: { tenantId: 1, idempotencyKeyHash: 1 },
      name: 'ux_subscription_transfer_idempotency',
      unique: true,
      partialFilterExpression: { idempotencyKeyHash: { $type: 'string' } },
    },
    {
      key: { tenantId: 1, subscriptionId: 1 },
      name: 'ux_subscription_transfer_open',
      unique: true,
      partialFilterExpression: { status: { $in: ['PENDING_REVIEW', 'APPROVED'] } },
    },
    {
      key: { tenantId: 1, status: 1, submittedAt: -1, _id: -1 },
      name: 'ix_subscription_transfer_tenant',
    },
  ],
  doctor_service_assignments: [
    {
      key: { tenantId: 1, doctorId: 1, serviceId: 1, scopeType: 1, scopeId: 1 },
      name: 'ux_doctor_service_scope',
      unique: true,
    },
    {
      key: { tenantId: 1, doctorId: 1, createdAt: 1, scopeType: 1, scopeId: 1 },
      name: 'ix_doctor_service_list',
    },
  ],
  facility_scheduling_policies: [
    { key: { tenantId: 1, facilityId: 1 }, name: 'ux_facility_scheduling_policy', unique: true },
    {
      key: { tenantId: 1, status: 1, facilityId: 1 },
      name: 'ix_facility_scheduling_policy_active',
    },
  ],
  facility_scheduling_policy_revisions: [
    { key: { policyId: 1, version: 1 }, name: 'ux_scheduling_policy_revision', unique: true },
    {
      key: { tenantId: 1, facilityId: 1, version: -1, _id: -1 },
      name: 'ix_scheduling_policy_revision_history',
    },
  ],
  platform_audit_logs: [
    { key: { eventType: 1, occurredAt: 1 }, name: 'ix_audit_event_time' },
    { key: { actorUserId: 1, occurredAt: 1 }, name: 'ix_audit_actor_time' },
    { key: { subjectUserId: 1, occurredAt: 1 }, name: 'ix_audit_subject_user_time' },
    { key: { subjectTenantId: 1, occurredAt: 1 }, name: 'ix_audit_subject_tenant_time' },
    { key: { sessionId: 1, occurredAt: 1 }, name: 'ix_audit_session_time' },
  ],
  platform_security_events: [
    {
      key: { eventType: 1, status: 1, occurredAt: 1 },
      name: 'ix_security_event_status_time',
    },
    { key: { actorUserId: 1, occurredAt: 1 }, name: 'ix_security_actor_time' },
    { key: { subjectUserId: 1, occurredAt: 1 }, name: 'ix_security_subject_time' },
    { key: { sessionId: 1, occurredAt: 1 }, name: 'ix_security_session_time' },
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
  } catch (error) {
    if (process.env.THANARAH_TEST_MONGO_DIAGNOSTICS === '1') {
      const failure = error as { name?: string; code?: string | number; codeName?: string; message?: string };
      console.error('Platform Mongo index provisioning diagnostic', {
        name: failure.name,
        code: failure.code,
        codeName: failure.codeName,
        message: failure.message?.replace(/mongodb(?:\+srv)?:\/\/[^@\s]+@/gi, 'mongodb://[redacted]@'),
      });
    }
    throw new PlatformMongoUnavailableError();
  }
}

export async function verifyPlatformMongoIndexes(db: Db): Promise<void> {
  try {
    for (const [collectionName, required] of Object.entries(PLATFORM_MONGO_INDEXES)) {
      const actual = await db.collection(collectionName).listIndexes().toArray();
      for (const expected of required) {
        const found = actual.find((index) => index.name === expected.name);
        const keyMatches = Boolean(found) && JSON.stringify(found.key) === JSON.stringify(expected.key);
        const uniqueMatches = Boolean(found?.unique) === Boolean(expected.unique);
        const collationMatches =
          !expected.collation ||
          (found?.collation?.locale === expected.collation.locale &&
            found?.collation?.strength === expected.collation.strength);
        const partialFilterMatches =
          !expected.partialFilterExpression ||
          JSON.stringify(found?.partialFilterExpression) ===
            JSON.stringify(expected.partialFilterExpression);
        if (!keyMatches || !uniqueMatches || !collationMatches || !partialFilterMatches) {
          if (process.env.THANARAH_TEST_MONGO_DIAGNOSTICS === '1') {
            console.error('Platform Mongo index verification mismatch', {
              collectionName,
              indexName: expected.name,
              found: Boolean(found),
              keyMatches,
              uniqueMatches,
              collationMatches,
              partialFilterMatches,
            });
          }
          throw new PlatformMongoUnavailableError();
        }
      }
    }
  } catch (error) {
    if (
      process.env.THANARAH_TEST_MONGO_DIAGNOSTICS === '1' &&
      !(error instanceof PlatformMongoUnavailableError)
    ) {
      const failure = error as { name?: string; code?: string | number; codeName?: string; message?: string };
      console.error('Platform Mongo index verification diagnostic', {
        name: failure.name,
        code: failure.code,
        codeName: failure.codeName,
        message: failure.message?.replace(/mongodb(?:\+srv)?:\/\/[^@\s]+@/gi, 'mongodb://[redacted]@'),
      });
    }
    throw new PlatformMongoUnavailableError();
  }
}
