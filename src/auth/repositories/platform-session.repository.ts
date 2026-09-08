import { Injectable } from '@nestjs/common';
import {
  PlatformSessionStatus,
  Prisma,
  type PlatformRefreshTokenHistory,
  type PlatformSession,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

export type CreatePlatformSessionInput = Omit<
  Prisma.PlatformSessionUncheckedCreateInput,
  'id' | 'createdAt' | 'lastActivityAt'
>;

export type RefreshRotationResult =
  | { kind: 'rotated'; session: PlatformSession }
  | { kind: 'reused' }
  | { kind: 'not-found' }
  | { kind: 'revoked' }
  | { kind: 'compromised' }
  | { kind: 'expired' };

@Injectable()
export class PlatformSessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: CreatePlatformSessionInput): Promise<PlatformSession> {
    return this.prisma.platformSession.create({ data });
  }

  findById(id: string): Promise<PlatformSession | null> {
    return this.prisma.platformSession.findUnique({ where: { id } });
  }

  findByIdForUser(id: string, userId: string): Promise<PlatformSession | null> {
    return this.prisma.platformSession.findFirst({ where: { id, userId } });
  }

  listByUserId(userId: string): Promise<PlatformSession[]> {
    return this.prisma.platformSession.findMany({
      where: { userId },
      orderBy: { lastActivityAt: 'desc' },
    });
  }

  findActiveByUserId(userId: string): Promise<PlatformSession[]> {
    return this.prisma.platformSession.findMany({
      where: { userId, status: PlatformSessionStatus.ACTIVE, expiresAt: { gt: new Date() } },
      orderBy: { lastActivityAt: 'desc' },
    });
  }

  findByRefreshTokenHash(refreshTokenHash: string): Promise<PlatformSession | null> {
    return this.prisma.platformSession.findUnique({ where: { refreshTokenHash } });
  }

  updateLastActivity(id: string, at = new Date()): Promise<PlatformSession> {
    return this.prisma.platformSession.update({ where: { id }, data: { lastActivityAt: at } });
  }

  revoke(id: string, revokedBy?: string, reason?: string): Promise<PlatformSession> {
    return this.prisma.platformSession.update({
      where: { id },
      data: {
        status: PlatformSessionStatus.REVOKED,
        revokedAt: new Date(),
        revokedBy,
        revocationReason: reason,
      },
    });
  }

  async revokeOne(
    id: string,
    revokedBy?: string,
    reason?: string,
  ): Promise<PlatformSession | null> {
    const result = await this.prisma.platformSession.updateMany({
      where: { id, status: PlatformSessionStatus.ACTIVE },
      data: {
        status: PlatformSessionStatus.REVOKED,
        revokedAt: new Date(),
        revokedBy,
        revocationReason: reason,
      },
    });
    if (result.count === 1) return this.findById(id);
    return this.findById(id);
  }

  async revokeAllForUser(userId: string, revokedBy?: string, reason?: string): Promise<number> {
    const result = await this.prisma.platformSession.updateMany({
      where: { userId, status: PlatformSessionStatus.ACTIVE },
      data: {
        status: PlatformSessionStatus.REVOKED,
        revokedAt: new Date(),
        revokedBy,
        revocationReason: reason,
      },
    });
    return result.count;
  }

  revokeAll(userId: string, revokedBy?: string, reason?: string): Promise<number> {
    return this.revokeAllForUser(userId, revokedBy, reason);
  }

  markExpired(id: string): Promise<PlatformSession> {
    return this.prisma.platformSession.update({
      where: { id },
      data: { status: PlatformSessionStatus.EXPIRED },
    });
  }

  markCompromised(id: string): Promise<PlatformSession> {
    return this.prisma.platformSession.update({
      where: { id },
      data: { status: PlatformSessionStatus.COMPROMISED, revokedAt: new Date() },
    });
  }

  findByTokenFamilyId(tokenFamilyId: string): Promise<PlatformSession[]> {
    return this.prisma.platformSession.findMany({ where: { tokenFamilyId } });
  }

  updateRefreshTokenHash(id: string, refreshTokenHash: string): Promise<PlatformSession> {
    return this.prisma.platformSession.update({ where: { id }, data: { refreshTokenHash } });
  }

  findHistoryByTokenHash(tokenHash: string): Promise<PlatformRefreshTokenHistory | null> {
    return this.prisma.platformRefreshTokenHistory.findUnique({ where: { tokenHash } });
  }

  rotateAtomically(session: PlatformSession, newTokenHash: string): Promise<PlatformSession> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.platformRefreshTokenHistory.create({
        data: {
          sessionId: session.id,
          tokenFamilyId: session.tokenFamilyId,
          tokenHash: session.refreshTokenHash,
          expiresAt: session.expiresAt,
        },
      });
      return transaction.platformSession.update({
        where: { id: session.id, refreshTokenHash: session.refreshTokenHash },
        data: { refreshTokenHash: newTokenHash, lastActivityAt: new Date() },
      });
    });
  }

  async rotateByRefreshTokenHash(
    presentedHash: string,
    newTokenHash: string,
    now = new Date(),
  ): Promise<RefreshRotationResult> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (transaction) => {
            // Discovery is deliberately non-locking. Locking a missing unique
            // hash can acquire an InnoDB gap lock and deadlock the rotator.
            const discoveredCurrent = await transaction.platformSession.findUnique({
              where: { refreshTokenHash: presentedHash },
              select: { id: true },
            });
            const discoveredHistory = discoveredCurrent
              ? null
              : await transaction.platformRefreshTokenHistory.findUnique({
                  where: { tokenHash: presentedHash },
                  select: { id: true, sessionId: true },
                });
            const sessionId = discoveredCurrent?.id ?? discoveredHistory?.sessionId;
            if (!sessionId) return { kind: 'not-found' };

            // Every path locks the session by primary key first.
            const lockedRows = await transaction.$queryRaw<PlatformSession[]>(
              Prisma.sql`SELECT * FROM PlatformSession WHERE id = ${sessionId} FOR UPDATE`,
            );
            const locked = lockedRows[0];
            if (!locked) return { kind: 'not-found' };

            // A token discovered as current may have rotated while this
            // transaction waited for the session lock. Under READ COMMITTED,
            // this fresh history read observes that rotation.
            if (locked.refreshTokenHash !== presentedHash) {
              const history = await transaction.platformRefreshTokenHistory.findUnique({
                where: { tokenHash: presentedHash },
              });
              if (!history || history.sessionId !== locked.id) return { kind: 'not-found' };
              await transaction.platformRefreshTokenHistory.update({
                where: { id: history.id },
                data: { reuseDetectedAt: now },
              });
              await transaction.platformSession.update({
                where: { id: locked.id },
                data: {
                  status: PlatformSessionStatus.COMPROMISED,
                  revokedAt: now,
                  revocationReason: 'Refresh token reuse detected',
                },
              });
              return { kind: 'reused' };
            }

            if (locked.status === PlatformSessionStatus.REVOKED) return { kind: 'revoked' };
            if (locked.status === PlatformSessionStatus.COMPROMISED) {
              return { kind: 'compromised' };
            }
            if (locked.status === PlatformSessionStatus.EXPIRED || locked.expiresAt <= now) {
              if (locked.status !== PlatformSessionStatus.EXPIRED) {
                await transaction.platformSession.update({
                  where: { id: locked.id },
                  data: { status: PlatformSessionStatus.EXPIRED },
                });
              }
              return { kind: 'expired' };
            }
            await transaction.platformRefreshTokenHistory.create({
              data: {
                sessionId: locked.id,
                tokenFamilyId: locked.tokenFamilyId,
                tokenHash: locked.refreshTokenHash,
                expiresAt: locked.expiresAt,
              },
            });
            const updated = await transaction.platformSession.update({
              where: { id: locked.id, refreshTokenHash: presentedHash },
              data: { refreshTokenHash: newTokenHash, lastActivityAt: now },
            });
            return { kind: 'rotated', session: updated };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
        );
      } catch (error) {
        if (attempt === 3 || !this.isRetryableTransactionError(error)) throw error;
      }
    }
    throw new Error('Refresh rotation retry limit exhausted');
  }

  private isRetryableTransactionError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false;
    const candidate = error as { code?: unknown; message?: unknown };
    if (candidate.code === 'P2034') return true;
    return (
      typeof candidate.message === 'string' &&
      /deadlock|lock wait timeout|(?:error|errno)\s*:?\s*(?:1205|1213)/i.test(candidate.message)
    );
  }

  markReuseDetected(history: PlatformRefreshTokenHistory): Promise<void> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.platformRefreshTokenHistory.update({
        where: { id: history.id },
        data: { reuseDetectedAt: new Date() },
      });
      await transaction.platformSession.update({
        where: { id: history.sessionId },
        data: {
          status: PlatformSessionStatus.COMPROMISED,
          revokedAt: new Date(),
          revocationReason: 'Refresh token reuse detected',
        },
      });
    });
  }
}
