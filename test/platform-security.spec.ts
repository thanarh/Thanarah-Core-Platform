import type { FastifyReply, FastifyRequest } from 'fastify';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import {
  PlatformAuditEventType,
  PlatformAuditService,
  PlatformSecurityEventType,
} from '../src/platform-security/platform-audit.service';
import type { PlatformAuditRepository } from '../src/platform-security/platform-audit.repository';
import { PlatformSecurityModule } from '../src/platform-security/platform-security.module';
import { PlatformAuditRepository as PrismaPlatformAuditRepository } from '../src/platform-security/platform-audit.repository';
import { AuthenticationService } from '../src/auth/services/authentication.service';
import { AuthController } from '../src/auth/auth.controller';
import type { PlatformSessionService } from '../src/auth/services/platform-session.service';
import type { AuthCookieService } from '../src/auth/services/auth-cookie.service';
import type { AuthenticatedPlatformUser } from '../src/auth/auth.types';
import { AUTH_REVOCATION_REASONS } from '../src/auth/auth.constants';
import { AuthorizationForbiddenError } from '../src/auth/errors/authorization.errors';
import {
  RefreshSessionCompromisedError,
  RefreshTokenReusedError,
} from '../src/auth/errors/auth.errors';
import { RefreshTokenService } from '../src/auth/services/refresh-token.service';
import { TokenGeneratorService } from '../src/auth/security/token-generator.service';
import { TokenHasherService } from '../src/auth/security/token-hasher.service';

function repository(): {
  repository: PlatformAuditRepository;
  createAuditLog: ReturnType<typeof vi.fn>;
  createSecurityEvent: ReturnType<typeof vi.fn>;
  resolveSecurityEvent: ReturnType<typeof vi.fn>;
} {
  const createAuditLog = vi.fn().mockResolvedValue({});
  const createSecurityEvent = vi.fn().mockResolvedValue({});
  const resolveSecurityEvent = vi.fn().mockResolvedValue(true);
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
    const service = new PlatformAuditService(test.repository, {
      hasPermissions: vi.fn().mockResolvedValue(true),
    } as never);

    await service.recordAudit({
      eventType: PlatformAuditEventType.AUTH_LOGOUT,
      actorUserId: 'trusted-user',
      sessionId: 'trusted-session',
      metadata: {
        reason: 'USER_LOGOUT',
        password: 'never-persist',
        refreshToken: 'never-persist',
        authorization: 'Bearer should-not-persist',
        nested: { secret: 'never-persist' },
        details: 'password=should-not-persist',
        narrative: 'The password is also-not-for-logs',
        databaseInfo: 'mysql://user:password@host/database',
        opaque: 'a'.repeat(64),
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
    const service = new PlatformAuditService(test.repository, {
      hasPermissions: vi.fn().mockResolvedValue(true),
    } as never);

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
    const service = new PlatformAuditService(test.repository, {
      hasPermissions: vi.fn().mockResolvedValue(true),
    } as never);

    await expect(
      service.recordSecurityEvent({
        eventType: PlatformSecurityEventType.AUTH_LOGIN_FAILED,
        metadata: { reason: 'INVALID_CREDENTIALS' },
      }),
    ).resolves.toBeUndefined();
  });

  it('resolves using the authenticated actor and both existing update permissions', async () => {
    const test = repository();
    const authorization = { hasPermissions: vi.fn().mockResolvedValue(true) };
    const service = new PlatformAuditService(test.repository, authorization as never);
    const actor: AuthenticatedPlatformUser = {
      userId: 'authenticated-security-admin',
      sessionId: 'trusted-session',
      tokenVersion: 1,
      platformRoleIds: [],
    };

    await expect(
      service.resolveSecurityEvent('event-id', actor, 'Reviewed and contained'),
    ).resolves.toBe(true);

    expect(authorization.hasPermissions).toHaveBeenCalledWith('authenticated-security-admin', [
      'security_events.update',
      'security_events.resolve',
    ]);
    expect(test.resolveSecurityEvent).toHaveBeenCalledWith(
      'event-id',
      'authenticated-security-admin',
      'Reviewed and contained',
    );
  });

  it('rejects unauthorized resolution before repository access', async () => {
    const test = repository();
    const authorization = { hasPermissions: vi.fn().mockResolvedValue(false) };
    const service = new PlatformAuditService(test.repository, authorization as never);

    await expect(
      service.resolveSecurityEvent('event-id', {
        userId: 'user-without-resolution-permission',
        sessionId: 'session',
        tokenVersion: 1,
        platformRoleIds: [],
      }),
    ).rejects.toBeInstanceOf(AuthorizationForbiddenError);
    expect(test.resolveSecurityEvent).not.toHaveBeenCalled();
  });

  it('rejects actor context without an authenticated user ID', async () => {
    const test = repository();
    const authorization = { hasPermissions: vi.fn().mockResolvedValue(true) };
    const service = new PlatformAuditService(test.repository, authorization as never);

    await expect(
      service.resolveSecurityEvent('event-id', {
        userId: '',
        sessionId: 'session',
        tokenVersion: 1,
        platformRoleIds: [],
      }),
    ).rejects.toBeInstanceOf(AuthorizationForbiddenError);
    expect(authorization.hasPermissions).not.toHaveBeenCalled();
    expect(test.resolveSecurityEvent).not.toHaveBeenCalled();
  });

  it('reports a failed resolution persistence operation instead of swallowing it', async () => {
    const test = repository();
    const persistenceError = new Error('database detail');
    test.resolveSecurityEvent.mockRejectedValue(persistenceError);
    const service = new PlatformAuditService(test.repository, {
      hasPermissions: vi.fn().mockResolvedValue(true),
    } as never);

    await expect(
      service.resolveSecurityEvent('event-id', {
        userId: 'security-admin',
        sessionId: 'session',
        tokenVersion: 1,
        platformRoleIds: [],
      }),
    ).rejects.toBe(persistenceError);
  });

  it('sanitizes resolution notes using the same sensitive-content rules', async () => {
    const test = repository();
    const service = new PlatformAuditService(test.repository, {
      hasPermissions: vi.fn().mockResolvedValue(true),
    } as never);

    await service.resolveSecurityEvent(
      'event-id',
      {
        userId: 'security-admin',
        sessionId: 'session',
        tokenVersion: 1,
        platformRoleIds: [],
      },
      'Investigated; Authorization: Bearer very-secret-value',
    );

    expect(test.resolveSecurityEvent).toHaveBeenCalledWith('event-id', 'security-admin', undefined);
  });

  it('does not expose the raw repository from PlatformSecurityModule', () => {
    const exports = Reflect.getMetadata(MODULE_METADATA.EXPORTS, PlatformSecurityModule);
    expect(exports).toEqual([PlatformAuditService]);
    expect(exports).not.toContain(PrismaPlatformAuditRepository);
  });
});

describe('refresh security-event context', () => {
  it.each([
    {
      kind: 'reused' as const,
      eventType: PlatformSecurityEventType.AUTH_REFRESH_TOKEN_REUSE,
      detection: 'ROTATED_TOKEN_REUSE',
      error: RefreshTokenReusedError,
    },
    {
      kind: 'compromised' as const,
      eventType: PlatformSecurityEventType.AUTH_REFRESH_SESSION_COMPROMISED,
      detection: 'COMPROMISED_SESSION',
      error: RefreshSessionCompromisedError,
    },
  ])(
    'records the affected session and user for $kind without trusting a presenter actor',
    async ({ kind, eventType, detection, error }) => {
      const audit = { recordSecurityEvent: vi.fn().mockResolvedValue(undefined) };
      const sessions = {
        rotateByRefreshTokenHash: vi.fn().mockResolvedValue({
          kind,
          sessionId: 'affected-session',
          subjectUserId: 'affected-user',
        }),
      };
      const service = new RefreshTokenService(
        sessions as never,
        new TokenGeneratorService(),
        new TokenHasherService(),
        audit as never,
      );

      await expect(
        service.rotate('presented-refresh-token', {
          actorUserId: 'client-chosen-actor',
          sessionId: 'client-chosen-session',
          subjectUserId: 'client-chosen-subject',
          requestId: 'request-id',
          ipAddress: '192.0.2.8',
          userAgent: 'test-agent',
        }),
      ).rejects.toBeInstanceOf(error);

      expect(audit.recordSecurityEvent).toHaveBeenCalledWith({
        eventType,
        requestId: 'request-id',
        ipAddress: '192.0.2.8',
        userAgent: 'test-agent',
        sessionId: 'affected-session',
        subjectUserId: 'affected-user',
        metadata: { detection },
      });
      expect(audit.recordSecurityEvent.mock.calls[0][0]).not.toHaveProperty('actorUserId');
    },
  );
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
      { getRoleIdsByUserId: vi.fn().mockResolvedValue([]) } as never,
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
