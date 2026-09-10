import { Injectable, Logger } from '@nestjs/common';
import {
  PlatformAuditEventType,
  PlatformSecurityEventStatus,
  PlatformSecurityEventType,
  Prisma,
} from '@prisma/client';
import { PlatformAuditRepository } from './platform-audit.repository';
import type {
  CreatePlatformAuditInput,
  CreatePlatformSecurityEventInput,
  SafeSecurityMetadata,
  TrustedSecurityContext,
} from './platform-security.types';

const MAX_METADATA_FIELDS = 32;
const MAX_METADATA_STRING_LENGTH = 512;
const SENSITIVE_KEY =
  /(password|token|secret|cookie|credential|api[_-]?key|database[_-]?url|hash)/i;

@Injectable()
export class PlatformAuditService {
  private readonly logger = new Logger(PlatformAuditService.name);

  constructor(private readonly repository: PlatformAuditRepository) {}

  async recordAudit(input: CreatePlatformAuditInput): Promise<void> {
    if (!Object.values(PlatformAuditEventType).includes(input.eventType)) return;

    await this.tryPersist(() =>
      this.repository.createAuditLog({
        eventType: input.eventType,
        ...this.context(input),
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
    resolvedBy: TrustedSecurityContext,
    resolutionNote?: string,
  ): Promise<void> {
    const actorUserId = this.safeIdentifier(resolvedBy.actorUserId);
    if (!actorUserId || !eventId) return;

    await this.tryPersist(() =>
      this.repository.resolveSecurityEvent(eventId, actorUserId, this.safeNote(resolutionNote)),
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
        output[key] = value.slice(0, MAX_METADATA_STRING_LENGTH);
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
    return this.safeValue(value, 1000);
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
