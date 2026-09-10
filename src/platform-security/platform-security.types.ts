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
  metadata?: SafeSecurityMetadata;
}

export interface CreatePlatformSecurityEventInput extends TrustedSecurityContext {
  eventType: PlatformSecurityEventType;
  metadata?: SafeSecurityMetadata;
}
