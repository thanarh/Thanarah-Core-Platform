import { UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import cookie from '@fastify/cookie';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthController } from '../src/auth/auth.controller';
import type { AuthenticatedPlatformUser } from '../src/auth/auth.types';
import { PlatformAuthGuard } from '../src/auth/guards/platform-auth.guard';
import { AuthCookieService } from '../src/auth/services/auth-cookie.service';
import { PlatformSessionService } from '../src/auth/services/platform-session.service';
import { AuthenticationService } from '../src/auth/services/authentication.service';
import { AccessTokenService } from '../src/auth/services/access-token.service';
import {
  PLATFORM_SESSION_PERSISTENCE,
  PLATFORM_USER_PERSISTENCE,
} from '../src/persistence/platform-persistence.ports';
import type { ConfigService } from '../src/config/config.service';

const authenticatedUser: AuthenticatedPlatformUser = {
  userId: 'trusted-user',
  sessionId: 'trusted-session',
  tokenVersion: 4,
  platformRoleIds: ['role'],
};

class TestPlatformAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
      authenticatedPlatformUser?: AuthenticatedPlatformUser;
    }>();
    if (request.headers.authorization !== 'Bearer valid') {
      throw new UnauthorizedException();
    }
    request.authenticatedPlatformUser = authenticatedUser;
    return true;
  }
}

describe('Phase 12 auth HTTP contract', () => {
  let app: NestFastifyApplication;
  const sessions = {
    revokeOne: vi.fn().mockResolvedValue(null),
    revokeAll: vi.fn().mockResolvedValue(0),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const config = {
      refreshCookieName: 'thanarah_refresh',
      refreshCookieDomain: undefined,
      refreshCookieSecure: true,
      refreshCookieSameSite: 'strict',
      refreshTokenTtlDays: 30,
    } as ConfigService;
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: PlatformSessionService, useValue: sessions },
        { provide: AuthCookieService, useValue: new AuthCookieService(config) },
        { provide: AuthenticationService, useValue: { login: vi.fn(), refresh: vi.fn() } },
        { provide: PlatformAuthGuard, useClass: TestPlatformAuthGuard },
        { provide: Reflector, useValue: {} },
        { provide: AccessTokenService, useValue: {} },
        { provide: PLATFORM_USER_PERSISTENCE, useValue: {} },
        { provide: PLATFORM_SESSION_PERSISTENCE, useValue: {} },
      ],
    }).compile();

    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api');
    await app.register(cookie);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it.each(['/api/v1/auth/logout', '/api/v1/auth/logout-all'])(
    'rejects unauthenticated requests to %s',
    async (url) => {
      const response = await app.inject({ method: 'POST', url });
      expect(response.statusCode).toBe(401);
      expect(sessions.revokeOne).not.toHaveBeenCalled();
      expect(sessions.revokeAll).not.toHaveBeenCalled();
    },
  );

  it('serves logout at the exact URL and ignores hostile client scope', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout?sessionId=attacker-session',
      headers: { authorization: 'Bearer valid' },
      payload: { sessionId: 'attacker-session', userId: 'attacker-user' },
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    expect(response.headers['set-cookie']).toContain('thanarah_refresh=');
    expect(response.headers['set-cookie']).toContain('HttpOnly');
    expect(response.headers['set-cookie']).toContain('Secure');
    expect(response.headers['set-cookie']).toContain('SameSite=Strict');
    expect(sessions.revokeOne).toHaveBeenCalledWith(
      'trusted-session',
      'trusted-user',
      'USER_LOGOUT',
    );
    expect(sessions.revokeAll).not.toHaveBeenCalled();
  });

  it('serves logout-all at the exact URL and ignores hostile client scope', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout-all?userId=attacker-user',
      headers: { authorization: 'Bearer valid' },
      payload: { userId: 'attacker-user' },
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    expect(response.headers['set-cookie']).toContain('thanarah_refresh=');
    expect(sessions.revokeAll).toHaveBeenCalledWith(
      'trusted-user',
      'trusted-user',
      'USER_LOGOUT_ALL',
    );
    expect(sessions.revokeOne).not.toHaveBeenCalled();
  });
});
