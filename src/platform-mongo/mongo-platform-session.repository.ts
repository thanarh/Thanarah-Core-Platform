import { Injectable } from '@nestjs/common';
import type {
  PlatformRefreshRotationResult,
  PlatformSessionPersistencePort,
  PlatformSessionRecord,
} from '../persistence/platform-persistence.ports';
import { PlatformMongoClientManager } from './platform-mongo.client.manager';
import {
  PlatformDocumentConflictError,
  PlatformDocumentValidationError,
  PlatformMongoUnavailableError,
} from './platform-mongo.errors';
import {
  newStableId,
  platformRefreshTokenHistorySchema,
  platformSessionSchema,
  platformUserSchema,
} from './platform-mongo.models';
import type {
  PlatformRefreshTokenHistoryDocument,
  PlatformSessionDocument,
  PlatformUserDocument,
} from './platform-mongo.models';

const SESSION_COLLECTION = 'platform_sessions';
const HISTORY_COLLECTION = 'platform_refresh_token_history';

@Injectable()
export class MongoPlatformSessionRepository implements PlatformSessionPersistencePort {
  constructor(private readonly manager: PlatformMongoClientManager) {}

  async create(
    input: Parameters<PlatformSessionPersistencePort['create']>[0],
  ): Promise<PlatformSessionRecord> {
    const now = new Date();
    const document: PlatformSessionDocument = {
      _id: newStableId(),
      schemaVersion: 1,
      createdAt: now,
      userId: input.userId,
      refreshTokenHash: input.refreshTokenHash,
      tokenFamilyId: input.tokenFamilyId,
      status: 'ACTIVE',
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      deviceName: null,
      deviceType: null,
      browser: null,
      operatingSystem: null,
      countryCode: null,
      lastActivityAt: now,
      expiresAt: input.expiresAt,
      revokedAt: null,
      revokedBy: null,
      revocationReason: null,
    };
    try {
      this.parseSession(document);
      return await this.manager.withTransaction(async (session) => {
        const db = await this.manager.getDatabase();
        const user = await db
          .collection<PlatformUserDocument>('platform_users')
          .findOne({ _id: input.userId }, { session });
        if (!user || !platformUserSchema.safeParse(user).success) {
          throw new PlatformDocumentValidationError();
        }
        try {
          await db.collection<PlatformSessionDocument>(SESSION_COLLECTION).insertOne(document, {
            session,
          });
        } catch (error) {
          if (this.isDuplicateKey(error)) throw new PlatformDocumentConflictError();
          throw error;
        }
        return this.toRecord(document);
      });
    } catch (error) {
      this.rethrow(error);
    }
  }

  findById(id: string): Promise<PlatformSessionRecord | null> {
    return this.read(async (db) =>
      this.toOptionalRecord(
        await db.collection<PlatformSessionDocument>(SESSION_COLLECTION).findOne({ _id: id }),
      ),
    );
  }

  findByIdForUser(id: string, userId: string): Promise<PlatformSessionRecord | null> {
    return this.read(async (db) =>
      this.toOptionalRecord(
        await db
          .collection<PlatformSessionDocument>(SESSION_COLLECTION)
          .findOne({ _id: id, userId }),
      ),
    );
  }

  listByUserId(userId: string): Promise<PlatformSessionRecord[]> {
    return this.read(async (db) =>
      this.parseSessions(
        await db
          .collection<PlatformSessionDocument>(SESSION_COLLECTION)
          .find({ userId })
          .sort({ lastActivityAt: -1 })
          .toArray(),
      ),
    );
  }

  findActiveByUserId(userId: string): Promise<PlatformSessionRecord[]> {
    const now = new Date();
    return this.read(async (db) =>
      this.parseSessions(
        await db
          .collection<PlatformSessionDocument>(SESSION_COLLECTION)
          .find({ userId, status: 'ACTIVE', expiresAt: { $gt: now } })
          .sort({ lastActivityAt: -1 })
          .toArray(),
      ),
    );
  }

  findByRefreshTokenHash(hash: string): Promise<PlatformSessionRecord | null> {
    return this.read(async (db) =>
      this.toOptionalRecord(
        await db
          .collection<PlatformSessionDocument>(SESSION_COLLECTION)
          .findOne({ refreshTokenHash: hash }),
      ),
    );
  }

  updateLastActivity(id: string, at = new Date()): Promise<PlatformSessionRecord> {
    return this.updateOne(id, { lastActivityAt: at });
  }

  revoke(id: string, revokedBy?: string, reason?: string): Promise<PlatformSessionRecord> {
    return this.updateOne(id, {
      status: 'REVOKED',
      revokedAt: new Date(),
      revokedBy: revokedBy ?? null,
      revocationReason: reason ?? null,
    });
  }

  async revokeOne(
    id: string,
    revokedBy?: string,
    reason?: string,
  ): Promise<PlatformSessionRecord | null> {
    return this.write(async (db) => {
      const collection = db.collection<PlatformSessionDocument>(SESSION_COLLECTION);
      const result = await collection.findOneAndUpdate(
        { _id: id, userId: revokedBy, status: 'ACTIVE' },
        {
          $set: {
            status: 'REVOKED',
            revokedAt: new Date(),
            revokedBy: revokedBy ?? null,
            revocationReason: reason ?? null,
          },
        },
        { returnDocument: 'after' },
      );
      if (result) return this.toRecord(result);
      return this.toOptionalRecord(await collection.findOne({ _id: id }));
    });
  }

  revokeAllForUser(userId: string, revokedBy?: string, reason?: string): Promise<number> {
    return this.write(async (db) => {
      const result = await db.collection<PlatformSessionDocument>(SESSION_COLLECTION).updateMany(
        { userId, status: 'ACTIVE' },
        {
          $set: {
            status: 'REVOKED',
            revokedAt: new Date(),
            revokedBy: revokedBy ?? null,
            revocationReason: reason ?? null,
          },
        },
      );
      return result.modifiedCount;
    });
  }

  revokeAll(userId: string, revokedBy?: string, reason?: string): Promise<number> {
    return this.revokeAllForUser(userId, revokedBy, reason);
  }

  markExpired(id: string): Promise<PlatformSessionRecord> {
    return this.updateOne(id, { status: 'EXPIRED' });
  }

  markCompromised(id: string): Promise<PlatformSessionRecord> {
    return this.updateOne(id, { status: 'COMPROMISED', revokedAt: new Date() });
  }

  findByTokenFamilyId(tokenFamilyId: string): Promise<PlatformSessionRecord[]> {
    return this.read(async (db) =>
      this.parseSessions(
        await db
          .collection<PlatformSessionDocument>(SESSION_COLLECTION)
          .find({ tokenFamilyId })
          .toArray(),
      ),
    );
  }

  updateRefreshTokenHash(id: string, hash: string): Promise<PlatformSessionRecord> {
    return this.updateOne(id, { refreshTokenHash: hash });
  }

  async rotateByRefreshTokenHash(
    presentedHash: string,
    newTokenHash: string,
    now = new Date(),
  ): Promise<PlatformRefreshRotationResult> {
    try {
      return await this.manager.withTransaction(async (session) => {
        const db = await this.manager.getDatabase();
        const sessions = db.collection<PlatformSessionDocument>(SESSION_COLLECTION);
        const history = db.collection<PlatformRefreshTokenHistoryDocument>(HISTORY_COLLECTION);
        const current = await sessions.findOne({ refreshTokenHash: presentedHash }, { session });
        const prior = current
          ? null
          : await history.findOne({ tokenHash: presentedHash }, { session });
        const sessionId = current?._id ?? prior?.sessionId;
        if (!sessionId) return { kind: 'not-found' };

        const stored = await sessions.findOne({ _id: sessionId }, { session });
        if (!stored) return { kind: 'not-found' };
        const locked = this.parseSession(stored);

        if (locked.refreshTokenHash !== presentedHash) {
          const reused = await history.findOne({ tokenHash: presentedHash }, { session });
          if (!reused || reused.sessionId !== locked._id) return { kind: 'not-found' };
          await history.updateOne(
            { _id: reused._id },
            { $set: { reuseDetectedAt: now } },
            { session },
          );
          await sessions.updateOne(
            { _id: locked._id },
            {
              $set: {
                status: 'COMPROMISED',
                revokedAt: now,
                revocationReason: 'Refresh token reuse detected',
              },
            },
            { session },
          );
          return { kind: 'reused', sessionId: locked._id, subjectUserId: locked.userId };
        }
        if (locked.status === 'REVOKED') return { kind: 'revoked' };
        if (locked.status === 'COMPROMISED') {
          return { kind: 'compromised', sessionId: locked._id, subjectUserId: locked.userId };
        }
        if (locked.status === 'EXPIRED' || locked.expiresAt <= now) {
          if (locked.status !== 'EXPIRED') {
            await sessions.updateOne(
              { _id: locked._id },
              { $set: { status: 'EXPIRED' } },
              { session },
            );
          }
          return { kind: 'expired' };
        }

        const historyDocument: PlatformRefreshTokenHistoryDocument = {
          _id: newStableId(),
          schemaVersion: 1,
          sessionId: locked._id,
          tokenFamilyId: locked.tokenFamilyId,
          tokenHash: presentedHash,
          rotatedAt: now,
          expiresAt: locked.expiresAt,
          reuseDetectedAt: null,
        };
        this.parseHistory(historyDocument);
        await history.insertOne(historyDocument, { session });
        const updated = await sessions.findOneAndUpdate(
          { _id: locked._id, refreshTokenHash: presentedHash, status: 'ACTIVE' },
          { $set: { refreshTokenHash: newTokenHash, lastActivityAt: now } },
          { returnDocument: 'after', session },
        );
        if (!updated) throw new PlatformDocumentConflictError();
        return { kind: 'rotated', session: this.toRecord(updated) };
      });
    } catch (error) {
      if (
        error instanceof PlatformDocumentValidationError ||
        error instanceof PlatformDocumentConflictError
      ) {
        throw error;
      }
      if (this.isDuplicateKey(error)) throw new PlatformDocumentConflictError();
      throw new PlatformMongoUnavailableError();
    }
  }

  private updateOne(
    id: string,
    fields: Partial<PlatformSessionDocument>,
  ): Promise<PlatformSessionRecord> {
    return this.write(async (db) => {
      const updated = await db
        .collection<PlatformSessionDocument>(SESSION_COLLECTION)
        .findOneAndUpdate({ _id: id }, { $set: fields }, { returnDocument: 'after' });
      if (!updated) throw new PlatformDocumentValidationError();
      return this.toRecord(updated);
    });
  }

  private async read<T>(
    operation: (db: Awaited<ReturnType<PlatformMongoClientManager['getDatabase']>>) => Promise<T>,
  ): Promise<T> {
    try {
      return await operation(await this.manager.getDatabase());
    } catch (error) {
      this.rethrow(error);
    }
  }

  private async write<T>(
    operation: (db: Awaited<ReturnType<PlatformMongoClientManager['getDatabase']>>) => Promise<T>,
  ): Promise<T> {
    try {
      return await operation(await this.manager.getDatabase());
    } catch (error) {
      this.rethrow(error);
    }
  }

  private rethrow(error: unknown): never {
    if (
      error instanceof PlatformDocumentValidationError ||
      error instanceof PlatformDocumentConflictError
    )
      throw error;
    if (this.isDuplicateKey(error)) throw new PlatformDocumentConflictError();
    throw new PlatformMongoUnavailableError();
  }

  private isDuplicateKey(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 11000
    );
  }

  private parseSession(value: unknown): PlatformSessionDocument {
    const parsed = platformSessionSchema.safeParse(value);
    if (!parsed.success) throw new PlatformDocumentValidationError();
    return parsed.data;
  }

  private parseHistory(value: unknown): PlatformRefreshTokenHistoryDocument {
    const parsed = platformRefreshTokenHistorySchema.safeParse(value);
    if (!parsed.success) throw new PlatformDocumentValidationError();
    return parsed.data;
  }

  private parseSessions(values: unknown[]): PlatformSessionRecord[] {
    return values.map((value) => this.toRecord(value));
  }

  private toOptionalRecord(value: unknown): PlatformSessionRecord | null {
    return value === null ? null : this.toRecord(value);
  }

  private toRecord(value: unknown): PlatformSessionRecord {
    const document = this.parseSession(value);
    return {
      id: document._id,
      userId: document.userId,
      refreshTokenHash: document.refreshTokenHash,
      tokenFamilyId: document.tokenFamilyId,
      status: document.status,
      ipAddress: document.ipAddress,
      userAgent: document.userAgent,
      deviceName: document.deviceName,
      deviceType: document.deviceType,
      browser: document.browser,
      operatingSystem: document.operatingSystem,
      countryCode: document.countryCode,
      createdAt: document.createdAt,
      lastActivityAt: document.lastActivityAt,
      expiresAt: document.expiresAt,
      revokedAt: document.revokedAt,
      revokedBy: document.revokedBy,
      revocationReason: document.revocationReason,
    };
  }
}
