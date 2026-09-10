import type { FastifyReply, FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import {
  PlatformAuditEventType,
  PlatformAuditService,
  PlatformSecurityEventType,
} from '../src/platform-security/platform-audit.service';
import type { PlatformAuditRepository } from '../src/platform-security/platform-audit.repository';
import { AuthenticationService } from '../src/auth/services/authentication.service';
import { AuthController } from '../src/auth/auth.controller';
import type { PlatformSessionService } from '../src/auth/services/platform-session.service';
import type { AuthCookieService } from '../src/auth/services/auth-cookie.service';
import type { AuthenticatedPlatformUser } from '../src/auth/auth.types';
import { AUTH_REVOCATION_REASONS } from '../src/auth/auth.constants';

function repository(): {
  repository: PlatformAuditRepository;
  createAuditLog: ReturnType<typeof vi.fn>;
  createSecurityEvent: ReturnType<typeof vi.fn>;
  resolveSecurityEvent: ReturnType<typeof vi.fn>;
} {
  const createAuditLog = vi.fn().mockResolvedValue({});
  const createSecurityEvent = vi.fn().mockResolvedValue({});
  const resolveSecurityEvent = vi.fn().mockResolvedValue({});
  return {
    repository: {
      createAuditLog,
      createSecurityEvent,
      resolveSecurityEvent,
    } as unknown as PlatformAuditRepository,
    createAuditLog,
    createSecurityEvent,
    resolveSecurityEvent,
  };
}

describe('PlatformAuditService', () => {
  it('creates an audit record from trusted context and only safe metadata', async () => {
    const test = repository();
    const service = new PlatformAuditService(test.repository);

    await service.recordAudit({
      eventType: PlatformAuditEventType.AUTH_LOGOUT,
      actorUserId: 'trusted-user',
      sessionId: 'trusted-session',
      metadata: {
        reason: 'USER_LOGOUT',
        password: 'never-persist',
        refreshToken: 'never-persist',
        nested: { secret: 'never-persist' },
        longValue: 'x'.repeat(600),
      },
    });

    expect(test.createAuditLog).toHaveBeenCalledWith({
      eventType: PlatformAuditEventType.AUTH_LOGOUT,
      actorUserId: 'trusted-user',
      sessionId: 'trusted-session',
      metadata: {
        reason: 'USER_LOGOUT',
        longValue: 'x'.repeat(512),
      },
    });
    expect(JSON.stringify(test.createAuditLog.mock.calls[0][0])).not.toMatch(
      /never-persist|password|refreshToken|secret/i,
    );
  });

  it('uses the actor from trusted server context rather than metadata', async () => {
    const test = repository();
    const service = new PlatformAuditService(test.repository);

    await service.recordSecurityEvent({
      eventType: PlatformSecurityEventType.AUTHORIZATION_DENIED,
      actorUserId: 'server-authenticated-user',
      metadata: { actorUserId: 'attacker-controlled-user', requiredPermissionCount: 1 },
    });

    expect(test.createSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'server-authenticated-user',
        metadata: { actorUserId: 'attacker-controlled-user', requiredPermissionCount: 1 },
      }),
    );
  });

  it('does not throw when audit persistence fails', async () => {
    const test = repository();
    test.createSecurityEvent.mockRejectedValue(new Error('database details must stay internal'));
    const service = new PlatformAuditService(test.repository);

    await expect(
      service.recordSecurityEvent({
        eventType: PlatformSecurityEventType.AUTH_LOGIN_FAILED,
        metadata: { reason: 'INVALID_CREDENTIALS' },
      }),
    ).resolves.toBeUndefined();
  });

  it('resolves a security event through the repository without deleting its history', async () => {
    const test = repository();
    const service = new PlatformAuditService(test.repository);

    await service.resolveSecurityEvent(
      'event-id',
      { actorUserId: 'security-admin' },
      'Reviewed and contained',
    );

    expect(test.resolveSecurityEvent).toHaveBeenCalledWith(
      'event-id',
      'security-admin',
      'Reviewed and contained',
    );
  });
});

describe('authentication security-event integration', () => {
  it('records successful login with the server-authenticated actor and session', async () => {
    const audit = { recordAudit: vi.fn(), recordSecurityEvent: vi.fn() };
    const users = {
      findLoginRecordByEmail: vi.fn().mockResolvedValue({
        id: 'user-id',
        email: 'user@example.com',
        passwordHash: 'hash',
        status: 'ACTIVE',
        tokenVersion: 1,
        failedLoginAttempts: 0,
        lockedUntil: null,
      }),
      resetFailedLogins: vi.fn(),
      recordFailedLogin: vi.fn(),
    };
    const service = new AuthenticationService(
      users as never,
      { verify: vi.fn().mockResolvedValue(true) } as never,
      { refreshTokenTtlDays: 30, maxFailedLoginAttempts: 3, loginLockMinutes: 15 } as never,
      { create: vi.fn().mockResolvedValue({ id: 'session-id' }) } as never,
      {
        issue: vi.fn().mockReturnValue({ token: 'refresh', hash: 'hash' }),
      } as never,
      { sign: vi.fn().mockResolvedValue('access') } as never,
      { generateTokenFamilyId: vi.fn().mockReturnValue('family-id') } as never,
      { findRoleIdsByUserId: vi.fn().mockResolvedValue([]) } as never,
      audit as never,
    );

    await service.login('user@example.com', 'password', {
      ipAddress: '127.0.0.1',
      userAgent: 'test-agent',
    });

    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: PlatformAuditEventType.AUTH_LOGIN_SUCCEEDED,
        actorUserId: 'user-id',
        sessionId: 'session-id',
      }),
    );
  });

  it('records failed login and lockout without exposing the password', async () => {
    const audit = { recordAudit: vi.fn(), recordSecurityEvent: vi.fn() };
    const users = {
      findLoginRecordByEmail: vi.fn().mockResolvedValue({
        id: 'user-id',
        email: 'user@example.com',
        passwordHash: 'hash',
        status: 'ACTIVE',
        tokenVersion: 1,
        failedLoginAttempts: 2,
        lockedUntil: null,
      }),
      resetFailedLogins: vi.fn(),
      recordFailedLogin: vi.fn().mockResolvedValue({ lockApplied: true }),
    };
    const service = new AuthenticationService(
      users as never,
      { verify: vi.fn().mockResolvedValue(false) } as never,
      { refreshTokenTtlDays: 30, maxFailedLoginAttempts: 3, loginLockMinutes: 15 } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      audit as never,
    );

    await expect(
      service.login('user@example.com', 'do-not-persist', {
        ipAddress: '127.0.0.1',
        userAgent: null,
      }),
    ).rejects.toMatchObject({ response: { code: 'AUTH_INVALID_CREDENTIALS' } });

    expect(audit.recordSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: PlatformSecurityEventType.AUTH_LOGIN_FAILED,
        subjectUserId: 'user-id',
        metadata: { reason: 'INVALID_CREDENTIALS' },
      }),
    );
    expect(audit.recordSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: PlatformSecurityEventType.AUTH_ACCOUNT_LOCKED,
        subjectUserId: 'user-id',
      }),
    );
    expect(JSON.stringify(audit.recordSecurityEvent.mock.calls)).not.toContain('do-not-persist');
  });
});

describe('logout audit integration', () => {
  it('records logout using only the authenticated platform user context', async () => {
    const audit = { recordAudit: vi.fn() };
    const sessions = {
      revokeOne: vi.fn().mockResolvedValue(null),
      revokeAll: vi.fn(),
    };
    const cookies = { clearRefreshToken: vi.fn() };
    const user: AuthenticatedPlatformUser = {
      userId: 'trusted-user',
      sessionId: 'trusted-session',
      tokenVersion: 1,
      platformRoleIds: [],
    };
    const controller = new AuthController(
      sessions as unknown as PlatformSessionService,
      cookies as unknown as AuthCookieService,
      {} as never,
      audit as never,
    );

    await controller.logout(
      user,
      {} as FastifyReply,
      { ip: '127.0.0.1', headers: {} } as FastifyRequest,
    );

    expect(sessions.revokeOne).toHaveBeenCalledWith(
      'trusted-session',
      'trusted-user',
      AUTH_REVOCATION_REASONS.USER_LOGOUT,
    );
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: PlatformAuditEventType.AUTH_LOGOUT,
        actorUserId: 'trusted-user',
        sessionId: 'trusted-session',
      }),
    );
  });
});
