import type { PlanFeatureQuotaLimits } from '../platform-catalog/plan-feature-quota';

export const FEATURE_PERSISTENCE = Symbol('FEATURE_PERSISTENCE');
export const PLAN_PERSISTENCE = Symbol('PLAN_PERSISTENCE');
export const PLATFORM_AUDIT_PERSISTENCE = Symbol('PLATFORM_AUDIT_PERSISTENCE');
export const PLATFORM_USER_PERSISTENCE = Symbol('PLATFORM_USER_PERSISTENCE');
export const PLATFORM_SESSION_PERSISTENCE = Symbol('PLATFORM_SESSION_PERSISTENCE');
export const PLATFORM_AUTHORIZATION_PERSISTENCE = Symbol('PLATFORM_AUTHORIZATION_PERSISTENCE');

export type PlatformUserStatusValue = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
export type PlatformSessionStatusValue = 'ACTIVE' | 'REVOKED' | 'EXPIRED' | 'COMPROMISED';
export type PlatformRoleCodeValue =
  | 'OWNER'
  | 'SUPER_ADMIN'
  | 'PLATFORM_ADMIN'
  | 'SECURITY_ADMIN'
  | 'SUPPORT_ADMIN';

export interface PlatformUserAuthRecord {
  id: string;
  status: PlatformUserStatusValue;
  tokenVersion: number;
}

export interface PlatformLoginUserRecord extends PlatformUserAuthRecord {
  email: string;
  passwordHash: string;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
}

export interface PlatformUserPersistencePort {
  findAuthRecordById(id: string): Promise<PlatformUserAuthRecord | null>;
  findLoginRecordByEmail(email: string): Promise<PlatformLoginUserRecord | null>;
  recordFailedLogin(
    id: string,
    threshold: number,
    lockMinutes: number,
  ): Promise<{ lockApplied: boolean }>;
  resetFailedLogins(id: string): Promise<void>;
}

export interface CreatePlatformSessionRecord {
  userId: string;
  refreshTokenHash: string;
  tokenFamilyId: string;
  expiresAt: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface PlatformSessionRecord {
  id: string;
  userId: string;
  refreshTokenHash: string;
  tokenFamilyId: string;
  status: PlatformSessionStatusValue;
  ipAddress: string | null;
  userAgent: string | null;
  deviceName: string | null;
  deviceType: string | null;
  browser: string | null;
  operatingSystem: string | null;
  countryCode: string | null;
  createdAt: Date;
  lastActivityAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedBy: string | null;
  revocationReason: string | null;
}

export type PlatformRefreshRotationResult =
  | { kind: 'rotated'; session: PlatformSessionRecord }
  | { kind: 'reused'; sessionId: string; subjectUserId: string }
  | { kind: 'not-found' }
  | { kind: 'revoked' }
  | { kind: 'compromised'; sessionId: string; subjectUserId: string }
  | { kind: 'expired' };

export interface PlatformSessionPersistencePort {
  create(data: CreatePlatformSessionRecord): Promise<PlatformSessionRecord>;
  findById(id: string): Promise<PlatformSessionRecord | null>;
  findByIdForUser(id: string, userId: string): Promise<PlatformSessionRecord | null>;
  listByUserId(userId: string): Promise<PlatformSessionRecord[]>;
  findActiveByUserId(userId: string): Promise<PlatformSessionRecord[]>;
  findByRefreshTokenHash(hash: string): Promise<PlatformSessionRecord | null>;
  updateLastActivity(id: string, at?: Date): Promise<PlatformSessionRecord>;
  revoke(id: string, revokedBy?: string, reason?: string): Promise<PlatformSessionRecord>;
  revokeOne(id: string, revokedBy?: string, reason?: string): Promise<PlatformSessionRecord | null>;
  revokeAllForUser(userId: string, revokedBy?: string, reason?: string): Promise<number>;
  revokeAll(userId: string, revokedBy?: string, reason?: string): Promise<number>;
  markExpired(id: string): Promise<PlatformSessionRecord>;
  markCompromised(id: string): Promise<PlatformSessionRecord>;
  findByTokenFamilyId(tokenFamilyId: string): Promise<PlatformSessionRecord[]>;
  updateRefreshTokenHash(id: string, hash: string): Promise<PlatformSessionRecord>;
  rotateByRefreshTokenHash(
    presentedHash: string,
    newTokenHash: string,
    now?: Date,
  ): Promise<PlatformRefreshRotationResult>;
}

export interface PlatformAuthorizationPersistencePort {
  findRoleCodesByUserId(userId: string): Promise<PlatformRoleCodeValue[]>;
  findRoleIdsByUserId(userId: string): Promise<string[]>;
  findPermissionCodesByUserId(userId: string): Promise<string[]>;
}

export type FeatureStatusValue = 'ACTIVE' | 'INACTIVE';
export type PlanStatusValue = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';

export interface FeatureRecord {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: FeatureStatusValue;
  statusChangedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface FeatureListFilter {
  status?: FeatureStatusValue;
  limit: number;
  offset: number;
}

export interface FeatureCreateInput {
  key: string;
  name: string;
  description?: string;
}

export interface FeatureUpdateInput {
  name?: string;
  description?: string | null;
}

export interface FeaturePersistencePort {
  create(input: FeatureCreateInput): Promise<FeatureRecord>;
  findById(id: string): Promise<FeatureRecord | null>;
  findByKey(key: string): Promise<FeatureRecord | null>;
  list(filter: FeatureListFilter): Promise<FeatureRecord[]>;
  updateIfCurrentStatus(
    id: string,
    expectedStatus: FeatureStatusValue,
    input: FeatureUpdateInput,
  ): Promise<FeatureRecord | null>;
  changeStatusIfCurrent(
    id: string,
    expectedStatus: FeatureStatusValue,
    nextStatus: FeatureStatusValue,
    changedAt: Date,
  ): Promise<FeatureRecord | null>;
}

export interface PlanRecord {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: PlanStatusValue;
  statusChangedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlanFeatureRecord {
  planId: string;
  featureId: string;
  enabled: boolean;
  quotaLimits: unknown;
  createdAt: Date;
  updatedAt: Date;
  feature: FeatureRecord;
}

export interface PlanListFilter {
  status?: PlanStatusValue;
  limit: number;
  offset: number;
}

export interface PlanCreateInput {
  key: string;
  name: string;
  description?: string;
}

export interface PlanUpdateInput {
  name?: string;
  description?: string | null;
}

export interface PlanFeatureConfigurationInput {
  enabled?: boolean;
  quotaLimits?: PlanFeatureQuotaLimits | null;
}

export interface PlanPersistencePort {
  create(input: PlanCreateInput): Promise<PlanRecord>;
  findById(id: string): Promise<PlanRecord | null>;
  findByKey(key: string): Promise<PlanRecord | null>;
  list(filter: PlanListFilter): Promise<PlanRecord[]>;
  updateIfCurrentStatus(
    id: string,
    expectedStatus: PlanStatusValue,
    input: PlanUpdateInput,
  ): Promise<PlanRecord | null>;
  changeStatusIfCurrent(
    id: string,
    expectedStatus: PlanStatusValue,
    nextStatus: PlanStatusValue,
    changedAt: Date,
  ): Promise<PlanRecord | null>;
  findPlanFeature(planId: string, featureId: string): Promise<PlanFeatureRecord | null>;
  listFeatures(planId: string): Promise<PlanFeatureRecord[]>;
  attachFeature(planId: string, featureId: string): Promise<PlanFeatureRecord>;
  updateFeatureConfiguration(
    planId: string,
    featureId: string,
    input: PlanFeatureConfigurationInput,
  ): Promise<PlanFeatureRecord | null>;
  detachFeature(planId: string, featureId: string): Promise<boolean>;
}

export type PlatformAuditEvent =
  | 'AUTH_LOGIN_SUCCEEDED'
  | 'AUTH_LOGOUT'
  | 'AUTH_LOGOUT_ALL'
  | 'TENANT_CREATED'
  | 'TENANT_STATUS_CHANGED'
  | 'TENANT_DEACTIVATED'
  | 'TENANT_MEMBERSHIP_INVITED'
  | 'TENANT_MEMBERSHIP_ACTIVATED'
  | 'TENANT_MEMBERSHIP_SUSPENDED'
  | 'TENANT_MEMBERSHIP_REMOVED'
  | 'TENANT_ROLE_CREATED'
  | 'TENANT_ROLE_UPDATED'
  | 'TENANT_ROLE_PERMISSIONS_UPDATED'
  | 'TENANT_MEMBERSHIP_ROLE_ASSIGNED'
  | 'TENANT_MEMBERSHIP_ROLE_REMOVED'
  | 'TENANT_OWNER_ASSIGNED'
  | 'TENANT_AUTHORIZATION_DENIED'
  | 'FACILITY_CREATED'
  | 'FACILITY_UPDATED'
  | 'FACILITY_SUSPENDED'
  | 'FACILITY_ACTIVATED'
  | 'FACILITY_DEACTIVATED'
  | 'BRANCH_CREATED'
  | 'BRANCH_UPDATED'
  | 'BRANCH_SUSPENDED'
  | 'BRANCH_ACTIVATED'
  | 'BRANCH_DEACTIVATED'
  | 'STAFF_CREATED'
  | 'STAFF_UPDATED'
  | 'STAFF_SUSPENDED'
  | 'STAFF_ACTIVATED'
  | 'STAFF_DEACTIVATED'
  | 'STAFF_ROLE_ASSIGNED'
  | 'STAFF_ROLE_REMOVED'
  | 'STAFF_FACILITY_ASSIGNED'
  | 'STAFF_FACILITY_UNASSIGNED'
  | 'STAFF_BRANCH_ASSIGNED'
  | 'STAFF_BRANCH_UNASSIGNED'
  | 'DEPARTMENT_CREATED'
  | 'DEPARTMENT_UPDATED'
  | 'DEPARTMENT_ACTIVATED'
  | 'DEPARTMENT_SUSPENDED'
  | 'DEPARTMENT_DEACTIVATED'
  | 'SPECIALTY_CREATED'
  | 'SPECIALTY_UPDATED'
  | 'SPECIALTY_ACTIVATED'
  | 'SPECIALTY_SUSPENDED'
  | 'SPECIALTY_DEACTIVATED'
  | 'SERVICE_CREATED'
  | 'SERVICE_UPDATED'
  | 'SERVICE_STATUS_CHANGED'
  | 'DOCTOR_CREATED'
  | 'DOCTOR_UPDATED'
  | 'DOCTOR_ACTIVATED'
  | 'DOCTOR_SUSPENDED'
  | 'DOCTOR_DEACTIVATED'
  | 'DOCTOR_DEPARTMENT_ASSIGNED'
  | 'DOCTOR_DEPARTMENT_UNASSIGNED'
  | 'DOCTOR_SPECIALTY_ASSIGNED'
  | 'DOCTOR_SPECIALTY_UNASSIGNED'
  | 'PATIENT_CREATED'
  | 'PATIENT_UPDATED'
  | 'PATIENT_STATUS_CHANGED'
  | 'APPOINTMENT_CREATED'
  | 'APPOINTMENT_UPDATED'
  | 'APPOINTMENT_RESCHEDULED'
  | 'APPOINTMENT_CANCELLED'
  | 'ENCOUNTER_CREATED'
  | 'ENCOUNTER_CLINICAL_UPDATED'
  | 'ENCOUNTER_COMPLETED'
  | 'ENCOUNTER_CANCELLED'
  | 'SCHEDULING_POLICY_CREATED'
  | 'SCHEDULING_POLICY_UPDATED'
  | 'SCHEDULING_POLICY_ACTIVATED'
  | 'SCHEDULING_POLICY_DEACTIVATED'
  | 'PLAN_CREATED'
  | 'PLAN_UPDATED'
  | 'PLAN_ACTIVATED'
  | 'PLAN_DEACTIVATED'
  | 'PLAN_ARCHIVED'
  | 'FEATURE_CREATED'
  | 'FEATURE_UPDATED'
  | 'FEATURE_ACTIVATED'
  | 'FEATURE_DEACTIVATED'
  | 'PLAN_FEATURE_ATTACHED'
  | 'PLAN_FEATURE_UPDATED'
  | 'PLAN_FEATURE_DETACHED'
  | 'SUBSCRIPTION_CREATED'
  | 'SUBSCRIPTION_ACTIVATED'
  | 'SUBSCRIPTION_SUSPENDED'
  | 'SUBSCRIPTION_CANCELLED'
  | 'SUBSCRIPTION_EXPIRED';

export type PlatformSecurityEvent =
  | 'AUTH_LOGIN_FAILED'
  | 'AUTH_ACCOUNT_LOCKED'
  | 'AUTH_REFRESH_TOKEN_REUSE'
  | 'AUTH_REFRESH_SESSION_COMPROMISED'
  | 'AUTHORIZATION_DENIED';

export interface AuditSecurityContext {
  actorUserId?: string;
  subjectUserId?: string;
  subjectTenantId?: string;
  sessionId?: string;
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
}

export type SafeAuditMetadata = Readonly<Record<string, string | number | boolean | null>>;

export interface CreatePlatformAuditRecord extends AuditSecurityContext {
  id?: string;
  eventType: PlatformAuditEvent;
  metadata: SafeAuditMetadata;
}

export interface CreatePlatformSecurityRecord extends AuditSecurityContext {
  eventType: PlatformSecurityEvent;
  metadata: SafeAuditMetadata;
}

export interface PlatformAuditRecord {
  id: string;
  eventType: PlatformAuditEvent;
  actorUserId: string | null;
  subjectUserId: string | null;
  subjectTenantId: string | null;
  sessionId: string | null;
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  occurredAt: Date;
  metadata: unknown;
}

export interface PlatformSecurityRecord {
  id: string;
  eventType: PlatformSecurityEvent;
  status: 'OPEN' | 'RESOLVED';
  actorUserId: string | null;
  subjectUserId: string | null;
  sessionId: string | null;
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  occurredAt: Date;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  updatedAt: Date;
  metadata: unknown;
}

export interface PlatformAuditPersistencePort {
  createAuditLog(data: CreatePlatformAuditRecord): Promise<PlatformAuditRecord>;
  findAuditLog(id: string): Promise<PlatformAuditRecord | null>;
  createSecurityEvent(data: CreatePlatformSecurityRecord): Promise<PlatformSecurityRecord>;
  resolveSecurityEvent(id: string, resolvedBy: string, resolutionNote?: string): Promise<boolean>;
}
