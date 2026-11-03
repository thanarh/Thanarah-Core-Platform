import { Injectable } from '@nestjs/common';
import type { ClientSession } from 'mongodb';
import type {
  CreatePlatformAuditRecord,
  CreatePlatformSecurityRecord,
  PlatformAuditPersistencePort,
  PlatformAuditRecord,
  PlatformSecurityRecord,
} from '../persistence/platform-persistence.ports';
import { PlatformMongoClientManager } from './platform-mongo.client.manager';
import {
  PlatformDocumentConflictError,
  PlatformDocumentValidationError,
  PlatformMongoUnavailableError,
} from './platform-mongo.errors';
import {
  newStableId,
  platformAuditLogSchema,
  platformSecurityEventSchema,
} from './platform-mongo.models';
import type {
  PlatformAuditLogDocument,
  PlatformSecurityEventDocument,
  TenantDocument,
  PlatformUserDocument,
} from './platform-mongo.models';

@Injectable()
export class MongoPlatformAuditRepository implements PlatformAuditPersistencePort {
  constructor(private readonly manager: PlatformMongoClientManager) {}

  async createAuditLog(data: CreatePlatformAuditRecord): Promise<PlatformAuditRecord> {
    const now = new Date();
    const document: PlatformAuditLogDocument = {
      _id: data.id ?? newStableId(),
      eventType: data.eventType as PlatformAuditLogDocument['eventType'],
      actorUserId: data.actorUserId ?? null,
      subjectUserId: data.subjectUserId ?? null,
      subjectTenantId: data.subjectTenantId ?? null,
      sessionId: data.sessionId ?? null,
      requestId: data.requestId ?? null,
      ipAddress: data.ipAddress ?? null,
      userAgent: data.userAgent ?? null,
      occurredAt: now,
      metadata: data.metadata,
    };
    const parsed = this.parseAudit(document);
    await this.transaction(async (db, session) => {
      await this.validateReferences(
        db,
        session,
        [parsed.actorUserId, parsed.subjectUserId],
        parsed.subjectTenantId,
      );
      try {
        await db.collection<PlatformAuditLogDocument>('platform_audit_logs').insertOne(parsed, {
          session,
        });
      } catch (error) {
        if (this.isDuplicateKey(error)) throw new PlatformDocumentConflictError();
        throw error;
      }
    });
    return this.toAuditRecord(parsed);
  }

  async findAuditLog(id: string): Promise<PlatformAuditRecord | null> {
    try {
      const document = await (
        await this.manager.getDatabase()
      )
        .collection<PlatformAuditLogDocument>('platform_audit_logs')
        .findOne({ _id: id });
      return document ? this.toAuditRecord(document) : null;
    } catch (error) {
      this.rethrow(error);
    }
  }

  async createSecurityEvent(data: CreatePlatformSecurityRecord): Promise<PlatformSecurityRecord> {
    const now = new Date();
    const document: PlatformSecurityEventDocument = {
      _id: newStableId(),
      schemaVersion: 1,
      eventType: data.eventType as PlatformSecurityEventDocument['eventType'],
      status: 'OPEN',
      actorUserId: data.actorUserId ?? null,
      subjectUserId: data.subjectUserId ?? null,
      sessionId: data.sessionId ?? null,
      requestId: data.requestId ?? null,
      ipAddress: data.ipAddress ?? null,
      userAgent: data.userAgent ?? null,
      metadata: data.metadata,
      occurredAt: now,
      resolvedAt: null,
      resolvedBy: null,
      resolutionNote: null,
      updatedAt: now,
    };
    const parsed = this.parseSecurity(document);
    await this.transaction(async (db, session) => {
      await this.validateReferences(db, session, [parsed.actorUserId, parsed.subjectUserId]);
      await db
        .collection<PlatformSecurityEventDocument>('platform_security_events')
        .insertOne(parsed, { session });
    });
    return this.toSecurityRecord(parsed);
  }

  async resolveSecurityEvent(
    id: string,
    resolvedBy: string,
    resolutionNote?: string,
  ): Promise<boolean> {
    return this.transaction(async (db, session) => {
      await this.validateReferences(db, session, [resolvedBy]);
      const now = new Date();
      const result = await db
        .collection<PlatformSecurityEventDocument>('platform_security_events')
        .updateOne(
          { _id: id, status: 'OPEN' },
          {
            $set: {
              status: 'RESOLVED',
              resolvedAt: now,
              resolvedBy,
              resolutionNote: resolutionNote ?? null,
              updatedAt: now,
            },
          },
          { session },
        );
      return result.modifiedCount === 1;
    });
  }

  private async transaction<T>(
    operation: (
      db: Awaited<ReturnType<PlatformMongoClientManager['getDatabase']>>,
      session: ClientSession,
    ) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.manager.withTransaction(async (session) =>
        operation(await this.manager.getDatabase(), session),
      );
    } catch (error) {
      this.rethrow(error);
    }
  }

  private async validateReferences(
    db: Awaited<ReturnType<PlatformMongoClientManager['getDatabase']>>,
    session: ClientSession,
    userIds: Array<string | null>,
    tenantId?: string | null,
  ): Promise<void> {
    const uniqueUsers = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
    if (uniqueUsers.length) {
      const found = await db
        .collection<PlatformUserDocument>('platform_users')
        .countDocuments({ _id: { $in: uniqueUsers } }, { session });
      if (found !== uniqueUsers.length) throw new PlatformDocumentConflictError();
    }
    if (
      tenantId &&
      !(await db
        .collection<TenantDocument>('tenants')
        .findOne({ _id: tenantId }, { session, projection: { _id: 1 } }))
    ) {
      throw new PlatformDocumentConflictError();
    }
  }

  private parseAudit(value: unknown): PlatformAuditLogDocument {
    const result = platformAuditLogSchema.safeParse(value);
    if (!result.success) throw new PlatformDocumentValidationError();
    return result.data;
  }

  private parseSecurity(value: unknown): PlatformSecurityEventDocument {
    const result = platformSecurityEventSchema.safeParse(value);
    if (!result.success) throw new PlatformDocumentValidationError();
    return result.data;
  }

  private toAuditRecord(document: PlatformAuditLogDocument): PlatformAuditRecord {
    const value = this.parseAudit(document);
    return {
      id: value._id,
      eventType: value.eventType,
      actorUserId: value.actorUserId,
      subjectUserId: value.subjectUserId,
      subjectTenantId: value.subjectTenantId,
      sessionId: value.sessionId,
      requestId: value.requestId,
      ipAddress: value.ipAddress,
      userAgent: value.userAgent,
      occurredAt: value.occurredAt,
      metadata: value.metadata,
    };
  }

  private toSecurityRecord(document: PlatformSecurityEventDocument): PlatformSecurityRecord {
    const value = this.parseSecurity(document);
    return {
      id: value._id,
      eventType: value.eventType,
      status: value.status,
      actorUserId: value.actorUserId,
      subjectUserId: value.subjectUserId,
      sessionId: value.sessionId,
      requestId: value.requestId,
      ipAddress: value.ipAddress,
      userAgent: value.userAgent,
      occurredAt: value.occurredAt,
      resolvedAt: value.resolvedAt,
      resolvedBy: value.resolvedBy,
      resolutionNote: value.resolutionNote,
      updatedAt: value.updatedAt,
      metadata: value.metadata,
    };
  }

  private rethrow(error: unknown): never {
    if (
      error instanceof PlatformDocumentConflictError ||
      error instanceof PlatformDocumentValidationError
    ) {
      throw error;
    }
    if (this.isDuplicateKey(error)) {
      throw new PlatformDocumentConflictError();
    }
    throw new PlatformMongoUnavailableError();
  }

  private isDuplicateKey(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
  }
}
