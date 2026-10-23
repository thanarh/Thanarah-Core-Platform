import type { PlatformAuditEventType, PlatformSecurityEventType } from '@prisma/client';

export interface TrustedSecurityContext {
  actorUserId?: string | null;
  subjectUserId?: string | null;
  sessionId?: string | null;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export type SafeSecurityMetadata = Record<string, unknown>;

export interface CreatePlatformAuditInput extends TrustedSecurityContext {
  eventType: PlatformAuditEventType;
  /** Stable UUID from an immutable source event, when one exists. */
  eventId?: string;
  subjectTenantId?: string | null;
  metadata?: SafeSecurityMetadata;
}

export interface CreatePlatformSecurityEventInput extends TrustedSecurityContext {
  eventType: PlatformSecurityEventType;
  metadata?: SafeSecurityMetadata;
}
