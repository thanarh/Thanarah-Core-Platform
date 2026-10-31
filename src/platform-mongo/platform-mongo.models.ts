import { z } from 'zod';
import { randomUUID } from 'node:crypto';

const uuid = z.string().uuid();
const timestamp = z.date();
const optionalTimestamp = timestamp.nullable();
const common = {
  _id: uuid,
  createdAt: timestamp,
  updatedAt: timestamp,
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
    ...common,
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
    ...common,
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
export type TenantMembershipDocument = z.infer<typeof tenantMembershipSchema>;
export type PlatformRoleDocument = z.infer<typeof platformRoleSchema>;
export type PlatformPermissionDocument = z.infer<typeof platformPermissionSchema>;
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
