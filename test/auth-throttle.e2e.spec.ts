import { type CanActivate, type ExecutionContext } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthController } from '../src/auth/auth.controller';
import { PlatformAuthGuard } from '../src/auth/guards/platform-auth.guard';
import { AuthCookieService } from '../src/auth/services/auth-cookie.service';
import { AuthenticationService } from '../src/auth/services/authentication.service';
import { PlatformSessionService } from '../src/auth/services/platform-session.service';

class AllowProtectedRoutesGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    return true;
  }
}

describe('Authentication endpoint throttling', () => {
  let app: NestFastifyApplication;
  const authentication = {
    login: vi.fn().mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    }),
    refresh: vi.fn().mockResolvedValue({
      accessToken: 'rotated-access-token',
      refreshToken: 'rotated-refresh-token',
    }),
  };
  const cookies = {
    readRefreshToken: vi.fn().mockReturnValue('presented-refresh-token'),
    setRefreshToken: vi.fn(),
    clearRefreshToken: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot({
          throttlers: [{ ttl: 60_000, limit: 100 }],
        }),
      ],
      controllers: [AuthController],
      providers: [
        { provide: PlatformSessionService, useValue: {} },
        { provide: AuthCookieService, useValue: cookies },
        { provide: AuthenticationService, useValue: authentication },
        PlatformAuthGuard,
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
    })
      .overrideGuard(PlatformAuthGuard)
      .useClass(AllowProtectedRoutesGuard)
      .compile();

    app = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ trustProxy: ['127.0.0.1'] }),
    );
    app.setGlobalPrefix('api');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('allows ten login attempts per trusted client and rejects the eleventh', async () => {
    // Keep Fastify's overloaded inject return type inferred for this local helper.
    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    const request = (clientIp: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { 'x-forwarded-for': clientIp, 'user-agent': 'throttle-test' },
        payload: { email: 'user@example.com', password: 'not-logged-or-returned' },
      });

    for (let attempt = 1; attempt <= 10; attempt += 1) {
      expect((await request('203.0.113.10')).statusCode).toBe(200);
    }
    expect((await request('203.0.113.10')).statusCode).toBe(429);
    expect((await request('203.0.113.11')).statusCode).toBe(200);
    expect(authentication.login).toHaveBeenLastCalledWith(
      'user@example.com',
      'not-logged-or-returned',
      { ipAddress: '203.0.113.11', userAgent: 'throttle-test' },
    );
  });

  it('allows thirty refresh attempts per trusted client and rejects the thirty-first', async () => {
    // Keep Fastify's overloaded inject return type inferred for this local helper.
    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    const request = (clientIp: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        headers: { 'x-forwarded-for': clientIp },
      });

    for (let attempt = 1; attempt <= 30; attempt += 1) {
      expect((await request('203.0.113.20')).statusCode).toBe(200);
    }
    expect((await request('203.0.113.20')).statusCode).toBe(429);
    expect((await request('203.0.113.21')).statusCode).toBe(200);
  });
});
