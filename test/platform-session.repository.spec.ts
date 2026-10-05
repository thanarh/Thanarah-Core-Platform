import { PlatformSessionStatus, type PlatformSession } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { PlatformSessionRepository } from '../src/auth/repositories/platform-session.repository';
import type { PrismaService } from '../src/database/prisma.service';

const activeSession = (): PlatformSession => ({
  id: 'session-1',
  userId: 'user-1',
  refreshTokenHash: 'old-hash',
  tokenFamilyId: 'family-1',
  status: PlatformSessionStatus.ACTIVE,
  ipAddress: null,
  userAgent: null,
  deviceName: null,
  deviceType: null,
  browser: null,
  operatingSystem: null,
  countryCode: null,
  createdAt: new Date(0),
  lastActivityAt: new Date(0),
  expiresAt: new Date('2100-01-01'),
  revokedAt: null,
  revokedBy: null,
  revocationReason: null,
});

// The inferred mock type is intentionally retained for Vitest method helpers.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function harness(locked: PlatformSession, current: object | null, history: object | null = null) {
  const events: string[] = [];
  const transaction = {
    platformSession: {
      findUnique: vi.fn(async () => {
        events.push('discover-current');
        return current;
      }),
      update: vi.fn(async (args: { data: { refreshTokenHash?: string } }) => {
        events.push(args.data.refreshTokenHash ? 'update-hash' : 'compromise-session');
        return {
          ...locked,
          refreshTokenHash: args.data.refreshTokenHash ?? locked.refreshTokenHash,
        };
      }),
    },
    platformRefreshTokenHistory: {
      findUnique: vi.fn(async () => {
        events.push('find-history');
        return history;
      }),
      create: vi.fn(async () => {
        events.push('create-history');
        return {};
      }),
      update: vi.fn(async () => {
        events.push('mark-reuse');
        return {};
      }),
    },
    $queryRaw: vi.fn(async (query: { values: unknown[] }) => {
      events.push(`lock-session:${String(query.values[0])}`);
      return [locked];
    }),
  };
  const prisma = {
    $transaction: vi.fn(
      async (callback: (client: typeof transaction) => Promise<unknown>, options: object) => {
        expect(options).toEqual({ isolationLevel: 'ReadCommitted' });
        return callback(transaction);
      },
    ),
  };
  return {
    repository: new PlatformSessionRepository(prisma as unknown as PrismaService),
    prisma,
    transaction,
    events,
  };
}

describe('PlatformSessionRepository atomic refresh protocol', () => {
  it('locks by session id, writes history, then updates the current hash', async () => {
    const test = harness(activeSession(), { id: 'session-1' });
    await expect(
      test.repository.rotateByRefreshTokenHash('old-hash', 'new-hash'),
    ).resolves.toMatchObject({
      kind: 'rotated',
      session: { id: 'session-1', tokenFamilyId: 'family-1', expiresAt: new Date('2100-01-01') },
    });
    expect(test.events).toEqual([
      'discover-current',
      'lock-session:session-1',
      'create-history',
      'update-hash',
    ]);
  });

  it('recognizes a token rotated while waiting for the lock as reuse', async () => {
    const locked = { ...activeSession(), refreshTokenHash: 'new-hash' };
    const history = { id: 'history-1', sessionId: 'session-1', tokenHash: 'old-hash' };
    const test = harness(locked, { id: 'session-1' }, history);
    await expect(test.repository.rotateByRefreshTokenHash('old-hash', 'next')).resolves.toEqual({
      kind: 'reused',
      sessionId: 'session-1',
      subjectUserId: 'user-1',
    });
    expect(test.events).toEqual([
      'discover-current',
      'lock-session:session-1',
      'find-history',
      'mark-reuse',
      'compromise-session',
    ]);
  });

  it('discovers history without locking, then locks its session first', async () => {
    const history = { id: 'history-1', sessionId: 'session-1', tokenHash: 'old-hash' };
    const test = harness({ ...activeSession(), refreshTokenHash: 'new-hash' }, null, history);
    await expect(test.repository.rotateByRefreshTokenHash('old-hash', 'next')).resolves.toEqual({
      kind: 'reused',
      sessionId: 'session-1',
      subjectUserId: 'user-1',
    });
    expect(test.events.indexOf('lock-session:session-1')).toBeLessThan(
      test.events.indexOf('mark-reuse'),
    );
  });

  it('returns the affected user and session for an already compromised token session', async () => {
    const locked = { ...activeSession(), status: PlatformSessionStatus.COMPROMISED };
    const test = harness(locked, { id: 'session-1' });

    await expect(test.repository.rotateByRefreshTokenHash('old-hash', 'next')).resolves.toEqual({
      kind: 'compromised',
      sessionId: 'session-1',
      subjectUserId: 'user-1',
    });
  });

  it('retries a retryable transaction conflict with fresh discovery', async () => {
    const test = harness(activeSession(), { id: 'session-1' });
    test.prisma.$transaction
      .mockRejectedValueOnce({ code: 'P2034', message: 'conflict' })
      .mockImplementationOnce(async (callback) => callback(test.transaction));
    await expect(
      test.repository.rotateByRefreshTokenHash('old-hash', 'new-hash'),
    ).resolves.toMatchObject({
      kind: 'rotated',
    });
    expect(test.prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(test.transaction.platformSession.findUnique).toHaveBeenCalledOnce();
  });

  it('surfaces non-retryable transaction errors', async () => {
    const test = harness(activeSession(), { id: 'session-1' });
    const failure = new Error('connection lost');
    test.prisma.$transaction.mockRejectedValueOnce(failure);
    await expect(test.repository.rotateByRefreshTokenHash('old-hash', 'new-hash')).rejects.toBe(
      failure,
    );
    expect(test.prisma.$transaction).toHaveBeenCalledOnce();
  });
});

describe('PlatformSessionRepository logout revocation', () => {
  // The inferred mock type is intentionally retained for Vitest method helpers.
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  function revocationHarness(updateCount: number) {
    const platformSession = {
      updateMany: vi.fn().mockResolvedValue({ count: updateCount }),
      findUnique: vi.fn().mockResolvedValue(activeSession()),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    };
    const platformRefreshTokenHistory = {
      delete: vi.fn(),
      deleteMany: vi.fn(),
    };
    const prisma = { platformSession, platformRefreshTokenHistory };
    return {
      repository: new PlatformSessionRepository(prisma as unknown as PrismaService),
      platformSession,
      platformRefreshTokenHistory,
    };
  }

  it('revokes one only when id, owner and ACTIVE status all match', async () => {
    const test = revocationHarness(1);

    await test.repository.revokeOne('session-1', 'user-1', 'USER_LOGOUT');

    expect(test.platformSession.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'session-1',
        userId: 'user-1',
        status: PlatformSessionStatus.ACTIVE,
      },
      data: {
        status: PlatformSessionStatus.REVOKED,
        revokedAt: expect.any(Date),
        revokedBy: 'user-1',
        revocationReason: 'USER_LOGOUT',
      },
    });
    const data = test.platformSession.updateMany.mock.calls[0]?.[0].data;
    expect(data).not.toHaveProperty('tokenVersion');
    expect(test.platformSession.delete).not.toHaveBeenCalled();
    expect(test.platformSession.deleteMany).not.toHaveBeenCalled();
    expect(test.platformRefreshTokenHistory.delete).not.toHaveBeenCalled();
    expect(test.platformRefreshTokenHistory.deleteMany).not.toHaveBeenCalled();
  });

  it('is idempotent for a non-active or mismatched session without a second write', async () => {
    const test = revocationHarness(0);

    await expect(test.repository.revokeOne('session-1', 'user-1', 'USER_LOGOUT')).resolves.toEqual(
      activeSession(),
    );

    expect(test.platformSession.updateMany).toHaveBeenCalledOnce();
    expect(test.platformSession.findUnique).toHaveBeenCalledWith({ where: { id: 'session-1' } });
  });

  it('revokes all and only ACTIVE sessions belonging to the trusted user', async () => {
    const test = revocationHarness(3);

    await expect(test.repository.revokeAll('user-1', 'user-1', 'USER_LOGOUT_ALL')).resolves.toBe(3);

    expect(test.platformSession.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', status: PlatformSessionStatus.ACTIVE },
      data: {
        status: PlatformSessionStatus.REVOKED,
        revokedAt: expect.any(Date),
        revokedBy: 'user-1',
        revocationReason: 'USER_LOGOUT_ALL',
      },
    });
    const data = test.platformSession.updateMany.mock.calls[0]?.[0].data;
    expect(data).not.toHaveProperty('tokenVersion');
    expect(test.platformSession.delete).not.toHaveBeenCalled();
    expect(test.platformSession.deleteMany).not.toHaveBeenCalled();
    expect(test.platformRefreshTokenHistory.delete).not.toHaveBeenCalled();
    expect(test.platformRefreshTokenHistory.deleteMany).not.toHaveBeenCalled();
  });

  it('is idempotent when no ACTIVE sessions remain and does not touch non-active rows', async () => {
    const test = revocationHarness(0);

    await expect(test.repository.revokeAll('user-1', 'user-1', 'USER_LOGOUT_ALL')).resolves.toBe(0);

    expect(test.platformSession.updateMany).toHaveBeenCalledOnce();
  });
});
