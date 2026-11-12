import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { PlatformAuditEventType, PlatformSecurityEventType } from '@prisma/client';

const uuid = z.string().uuid();
const timestamp = z.date();
const optionalTimestamp = timestamp.nullable();
const jsonValue: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValue),
    z.record(z.string(), jsonValue),
  ]),
);
const common = {
  _id: uuid,
  createdAt: timestamp,
  updatedAt: timestamp,
  schemaVersion: z.literal(1),
  referenceVersion: z.number().int().nonnegative().optional(),
};
const identity = {
  _id: uuid,
  schemaVersion: z.literal(1),
};

export const platformUserSchema = z
  .object({
    ...common,
    email: z.string().min(1).max(254),
    passwordHash: z.string().min(1).max(255),
    fullName: z.string().min(1).max(191),
    status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']),
    tokenVersion: z.number().int().nonnegative(),
    failedLoginAttempts: z.number().int().nonnegative(),
    lockedUntil: optionalTimestamp,
  })
  .strict();

export const tenantSchema = z
  .object({
    ...common,
    slug: z.string().min(1).max(64),
    legalName: z.string().min(1).max(191),
    displayName: z.string().min(1).max(191),
    status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']),
    statusChangedAt: timestamp,
    suspendedAt: optionalTimestamp,
    deactivatedAt: optionalTimestamp,
  })
  .strict();

export const facilitySchema = z
  .object({
    ...common,
    tenantId: uuid,
    name: z.string().min(1).max(191),
    status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']),
    statusChangedAt: timestamp,
    suspendedAt: optionalTimestamp,
    deactivatedAt: optionalTimestamp,
  })
  .strict();

export const tenantStaffSchema = z
  .object({
    ...common,
    tenantId: uuid,
    userId: uuid,
    membershipId: uuid,
    displayName: z.string().min(1).max(191),
    jobTitle: z.string().max(191).nullable(),
    status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']),
    statusChangedAt: timestamp,
    suspendedAt: optionalTimestamp,
    deactivatedAt: optionalTimestamp,
  })
  .strict();

const healthcareCatalogFields = {
  ...common,
  tenantId: uuid,
  name: z.string().min(1).max(191),
  description: z.string().max(512).nullable(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']),
  statusChangedAt: timestamp,
  suspendedAt: optionalTimestamp,
  deactivatedAt: optionalTimestamp,
};
export const departmentSchema = z.object(healthcareCatalogFields).strict();
export const specialtySchema = z.object(healthcareCatalogFields).strict();
export const serviceCatalogSchema = z
  .object({
    ...common,
    tenantId: uuid,
    name: z.string().min(1).max(191),
    code: z.string().max(64).nullable(),
    description: z.string().max(2000).nullable(),
    status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']),
    statusChangedAt: timestamp,
    suspendedAt: optionalTimestamp,
    deactivatedAt: optionalTimestamp,
  })
  .strict();
export const subscriptionSchema = z
  .object({
    ...common,
    tenantId: uuid,
    planId: uuid,
    status: z.enum(['ACTIVE', 'SUSPENDED', 'CANCELLED', 'EXPIRED']),
    startsAt: timestamp,
    endsAt: optionalTimestamp,
    cancelledAt: optionalTimestamp,
  })
  .strict();
export const tenantPermissionSchema = z
  .object({
    ...common,
    code: z.string().min(1).max(128),
    description: z.string().min(1).max(255),
  })
  .strict();
export const tenantRoleSchema = z
  .object({
    ...common,
    tenantId: uuid,
    code: z.string().min(1).max(64),
    name: z.string().min(1).max(128),
    description: z.string().max(512).nullable(),
    isSystemRole: z.boolean(),
  })
  .strict();
export const tenantRolePermissionSchema = z
  .object({
    _id: z.string().min(1),
    tenantRoleId: uuid,
    tenantPermissionId: uuid,
    assignedAt: timestamp,
  })
  .strict();
export const tenantMembershipRoleSchema = z
  .object({
    _id: z.string().min(1),
    tenantId: uuid,
    membershipId: uuid,
    tenantRoleId: uuid,
    assignedAt: timestamp,
  })
  .strict();
export const tenantStaffRoleSchema = z
  .object({
    _id: z.string().min(1),
    tenantId: uuid,
    staffId: uuid,
    tenantRoleId: uuid,
    assignedAt: timestamp,
  })
  .strict();
export const branchSchema = z
  .object({
    ...common,
    facilityId: uuid,
    name: z.string().min(1).max(191),
    status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']),
    statusChangedAt: timestamp,
    suspendedAt: optionalTimestamp,
    deactivatedAt: optionalTimestamp,
  })
  .strict();

const safeMetadataSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
);
const auditContextSchema = {
  actorUserId: uuid.nullable(),
  subjectUserId: uuid.nullable(),
  subjectTenantId: uuid.nullable(),
  sessionId: uuid.nullable(),
  requestId: z.string().max(128).nullable(),
  ipAddress: z.string().max(45).nullable(),
  userAgent: z.string().max(512).nullable(),
  occurredAt: timestamp,
  metadata: safeMetadataSchema,
};
export const platformAuditLogSchema = z
  .object({
    _id: uuid,
    eventType: z.nativeEnum(PlatformAuditEventType),
    ...auditContextSchema,
  })
  .strict();
export const platformSecurityEventSchema = z
  .object({
    ...identity,
    eventType: z.nativeEnum(PlatformSecurityEventType),
    status: z.enum(['OPEN', 'RESOLVED']),
    actorUserId: uuid.nullable(),
    subjectUserId: uuid.nullable(),
    sessionId: uuid.nullable(),
    requestId: z.string().max(128).nullable(),
    ipAddress: z.string().max(45).nullable(),
    userAgent: z.string().max(512).nullable(),
    metadata: safeMetadataSchema,
    occurredAt: timestamp,
    resolvedAt: optionalTimestamp,
    resolvedBy: uuid.nullable(),
    resolutionNote: z.string().max(1000).nullable(),
    updatedAt: timestamp,
  })
  .strict();

export const tenantMembershipSchema = z
  .object({
    ...common,
    tenantId: uuid,
    platformUserId: uuid,
    status: z.enum(['INVITED', 'ACTIVE', 'SUSPENDED', 'REMOVED']),
    statusChangedAt: timestamp,
    activatedAt: optionalTimestamp,
    suspendedAt: optionalTimestamp,
    removedAt: optionalTimestamp,
  })
  .strict();

export const platformRoleSchema = z
  .object({
    ...common,
    code: z.string().min(1).max(64),
  })
  .strict();

export const platformPermissionSchema = z
  .object({
    ...common,
    code: z.string().min(1).max(128),
  })
  .strict();

export const platformFeatureSchema = z
  .object({
    ...common,
    key: z.string().min(1).max(64),
    name: z.string().min(1).max(191),
    description: z.string().max(1000).nullable(),
    status: z.enum(['ACTIVE', 'INACTIVE']),
    statusChangedAt: timestamp,
  })
  .strict();

export const platformPlanSchema = z
  .object({
    ...common,
    key: z.string().min(1).max(64),
    name: z.string().min(1).max(191),
    description: z.string().max(1000).nullable(),
    status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']),
    statusChangedAt: timestamp,
  })
  .strict();

export const platformPlanFeatureSchema = z
  .object({
    _id: z.string().min(1),
    planId: uuid,
    featureId: uuid,
    enabled: z.boolean(),
    quotaLimits: jsonValue,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict();

export const platformRolePermissionSchema = z
  .object({
    _id: z.string().min(1),
    roleId: uuid,
    permissionId: uuid,
  })
  .strict();

export const platformUserRoleSchema = z
  .object({
    _id: z.string().min(1),
    userId: uuid,
    roleId: uuid,
  })
  .strict();

export const platformSessionSchema = z
  .object({
    ...identity,
    createdAt: timestamp,
    userId: uuid,
    refreshTokenHash: z.string().regex(/^[a-f0-9]{64}$/iu),
    tokenFamilyId: uuid,
    status: z.enum(['ACTIVE', 'REVOKED', 'EXPIRED', 'COMPROMISED']),
    ipAddress: z.string().max(45).nullable(),
    userAgent: z.string().max(512).nullable(),
    deviceName: z.string().max(191).nullable(),
    deviceType: z.string().max(64).nullable(),
    browser: z.string().max(128).nullable(),
    operatingSystem: z.string().max(128).nullable(),
    countryCode: z.string().length(2).nullable(),
    lastActivityAt: timestamp,
    expiresAt: timestamp,
    revokedAt: optionalTimestamp,
    revokedBy: uuid.nullable(),
    revocationReason: z.string().max(255).nullable(),
  })
  .strict();

export const platformRefreshTokenHistorySchema = z
  .object({
    ...identity,
    sessionId: uuid,
    tokenFamilyId: uuid,
    tokenHash: z.string().regex(/^[a-f0-9]{64}$/iu),
    rotatedAt: timestamp,
    expiresAt: timestamp,
    reuseDetectedAt: optionalTimestamp,
  })
  .strict();

export type PlatformUserDocument = z.infer<typeof platformUserSchema>;
export type TenantDocument = z.infer<typeof tenantSchema>;
export type FacilityDocument = z.infer<typeof facilitySchema>;
export type TenantStaffDocument = z.infer<typeof tenantStaffSchema>;
export type DepartmentDocument = z.infer<typeof departmentSchema>;
export type SpecialtyDocument = z.infer<typeof specialtySchema>;
export type ServiceCatalogDocument = z.infer<typeof serviceCatalogSchema>;
export type SubscriptionDocument = z.infer<typeof subscriptionSchema>;
export type TenantPermissionDocument = z.infer<typeof tenantPermissionSchema>;
export type TenantRoleDocument = z.infer<typeof tenantRoleSchema>;
export type TenantRolePermissionDocument = z.infer<typeof tenantRolePermissionSchema>;
export type TenantMembershipRoleDocument = z.infer<typeof tenantMembershipRoleSchema>;
export type TenantStaffRoleDocument = z.infer<typeof tenantStaffRoleSchema>;
export type BranchDocument = z.infer<typeof branchSchema>;
export type PlatformAuditLogDocument = z.infer<typeof platformAuditLogSchema>;
export type PlatformSecurityEventDocument = z.infer<typeof platformSecurityEventSchema>;
export type TenantMembershipDocument = z.infer<typeof tenantMembershipSchema>;
export type PlatformRoleDocument = z.infer<typeof platformRoleSchema>;
export type PlatformPermissionDocument = z.infer<typeof platformPermissionSchema>;
export type PlatformFeatureDocument = z.infer<typeof platformFeatureSchema>;
export type PlatformPlanDocument = z.infer<typeof platformPlanSchema>;
export type PlatformPlanFeatureDocument = z.infer<typeof platformPlanFeatureSchema>;
export type PlatformRolePermissionDocument = z.infer<typeof platformRolePermissionSchema>;
export type PlatformUserRoleDocument = z.infer<typeof platformUserRoleSchema>;
export type PlatformSessionDocument = z.infer<typeof platformSessionSchema>;
export type PlatformRefreshTokenHistoryDocument = z.infer<typeof platformRefreshTokenHistorySchema>;

export function stableAssignmentId(...parts: string[]): string {
  if (parts.length < 2 || parts.some((part) => !uuid.safeParse(part).success)) {
    throw new Error('Invalid platform assignment identifier');
  }
  return parts.map((part) => `${part.length}:${part}`).join('|');
}

export function newStableId(): string {
  return randomUUID();
}

export function documentTimestamps(now = new Date()): { createdAt: Date; updatedAt: Date } {
  return { createdAt: now, updatedAt: now };
}
