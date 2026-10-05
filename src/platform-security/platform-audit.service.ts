import { Injectable, Logger } from '@nestjs/common';
import {
  PlatformAuditEventType,
  PlatformSecurityEventStatus,
  PlatformSecurityEventType,
  Prisma,
} from '@prisma/client';
import { AuthorizationForbiddenError } from '../auth/errors/authorization.errors';
import type { AuthenticatedPlatformUser } from '../auth/auth.types';
import type { PlatformPermissionCode } from '../auth/platform-authorization.constants';
import { PlatformAuthorizationService } from '../auth/services/platform-authorization.service';
import { PlatformAuditRepository } from './platform-audit.repository';
import type {
  CreatePlatformAuditInput,
  CreatePlatformSecurityEventInput,
  SafeSecurityMetadata,
  TrustedSecurityContext,
} from './platform-security.types';

const MAX_METADATA_FIELDS = 32;
const MAX_METADATA_STRING_LENGTH = 512;
const MAX_RESOLUTION_NOTE_LENGTH = 1000;
const SENSITIVE_KEY =
  /(password|passphrase|passwd|pwd|token|secret|cookie|credential|api[_-]?key|database[_-]?url|connection[_-]?string|authorization|hash)/i;
const SENSITIVE_CONTENT_PATTERNS = [
  /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/-]+=*/i,
  /\b(?:password|passphrase|passwd|pwd|access[_\s-]?token|refresh[_\s-]?token|token[_\s-]?hash|secret|api[_\s-]?key|credential|authorization(?:\s+header)?|cookie|database[_\s-]?url|connection[_\s-]?string)\b(?:\s*[:=]|\s+is\b)\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/i,
  /\b(?:mysql|mariadb|postgres(?:ql)?|mongodb(?:\+srv)?|redis):\/\/[^\s"'<>]+/i,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /\b[A-Za-z0-9_-]{64}\b/,
  /\b[a-f\d]{64}\b/i,
  /\$(?:argon2(?:id|i|d)|2[aby])\$/i,
] as const;
const SECURITY_EVENT_RESOLUTION_PERMISSIONS: readonly PlatformPermissionCode[] = [
  'security_events.update',
  'security_events.resolve',
];

@Injectable()
export class PlatformAuditService {
  private readonly logger = new Logger(PlatformAuditService.name);

  constructor(
    private readonly repository: PlatformAuditRepository,
    private readonly authorization: PlatformAuthorizationService,
  ) {}

  async recordAudit(input: CreatePlatformAuditInput): Promise<void> {
    if (!Object.values(PlatformAuditEventType).includes(input.eventType)) return;

    await this.tryPersist(() =>
      this.repository.createAuditLog({
        eventType: input.eventType,
        ...this.context(input),
        subjectTenantId: this.safeIdentifier(input.subjectTenantId),
        metadata: this.metadata(input.metadata),
      }),
    );
  }

  async recordSecurityEvent(input: CreatePlatformSecurityEventInput): Promise<void> {
    if (!Object.values(PlatformSecurityEventType).includes(input.eventType)) return;

    await this.tryPersist(() =>
      this.repository.createSecurityEvent({
        eventType: input.eventType,
        ...this.context(input),
        metadata: this.metadata(input.metadata),
      }),
    );
  }

  async resolveSecurityEvent(
    eventId: string,
    actor: AuthenticatedPlatformUser,
    resolutionNote?: string,
  ): Promise<boolean> {
    const actorUserId = this.safeIdentifier(actor?.userId);
    if (!actorUserId) throw new AuthorizationForbiddenError();

    const authorized = await this.authorization.hasPermissions(
      actorUserId,
      SECURITY_EVENT_RESOLUTION_PERMISSIONS,
    );
    if (!authorized) throw new AuthorizationForbiddenError();

    const safeEventId = this.safeValue(eventId, 64);
    if (!safeEventId) return false;

    return this.repository.resolveSecurityEvent(
      safeEventId,
      actorUserId,
      this.safeNote(resolutionNote),
    );
  }

  private context(input: TrustedSecurityContext): {
    actorUserId?: string;
    subjectUserId?: string;
    sessionId?: string;
    requestId?: string;
    ipAddress?: string;
    userAgent?: string;
  } {
    return {
      actorUserId: this.safeIdentifier(input.actorUserId),
      subjectUserId: this.safeIdentifier(input.subjectUserId),
      sessionId: this.safeIdentifier(input.sessionId),
      requestId: this.safeValue(input.requestId, 128),
      ipAddress: this.safeValue(input.ipAddress, 45),
      userAgent: this.safeValue(input.userAgent, 512),
    };
  }

  private metadata(input: SafeSecurityMetadata | undefined): Prisma.InputJsonValue {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return {};

    const output: Record<string, string | number | boolean | null> = {};
    for (const [key, value] of Object.entries(input).slice(0, MAX_METADATA_FIELDS)) {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) || SENSITIVE_KEY.test(key)) continue;
      if (value === null || typeof value === 'boolean' || typeof value === 'number') {
        output[key] = value;
      } else if (typeof value === 'string') {
        const safeValue = value.slice(0, MAX_METADATA_STRING_LENGTH);
        if (!this.containsSensitiveContent(safeValue)) output[key] = safeValue;
      }
    }
    return output;
  }

  private safeIdentifier(value: string | null | undefined): string | undefined {
    return this.safeValue(value, 64);
  }

  private safeValue(value: string | null | undefined, maxLength: number): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, maxLength) : undefined;
  }

  private safeNote(value: string | undefined): string | undefined {
    const note = this.safeValue(value, MAX_RESOLUTION_NOTE_LENGTH);
    return note && !this.containsSensitiveContent(note) ? note : undefined;
  }

  private containsSensitiveContent(value: string): boolean {
    return SENSITIVE_CONTENT_PATTERNS.some((pattern) => pattern.test(value));
  }

  private async tryPersist(operation: () => Promise<unknown>): Promise<void> {
    try {
      await operation();
    } catch {
      // Audit failures must not change authentication or authorization semantics.
      this.logger.warn('Platform audit persistence failed');
    }
  }
}

export { PlatformAuditEventType, PlatformSecurityEventStatus, PlatformSecurityEventType };
