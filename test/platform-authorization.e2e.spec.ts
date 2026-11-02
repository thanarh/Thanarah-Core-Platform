import {
  Controller,
  Get,
  type CanActivate,
  type ExecutionContext,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedPlatformUser } from '../src/auth/auth.types';
import { RequirePermissions } from '../src/auth/decorators/require-permissions.decorator';
import { AuthenticationError } from '../src/auth/errors/auth.errors';
import { PlatformAuthGuard } from '../src/auth/guards/platform-auth.guard';
import { PlatformAuthorizationGuard } from '../src/auth/guards/platform-authorization.guard';
import type { PlatformAuthorizationService } from '../src/auth/services/platform-authorization.service';

const authenticatedUser: AuthenticatedPlatformUser = {
  userId: 'trusted-user',
  sessionId: 'trusted-session',
  tokenVersion: 1,
  platformRoleIds: ['untrusted-token-role'],
};

class TestAuthenticationGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
      authenticatedPlatformUser?: AuthenticatedPlatformUser;
    }>();
    if (request.headers.authorization !== 'Bearer valid') {
      throw new AuthenticationError('AUTH_TOKEN_MISSING', 'Authorization token is required');
    }
    request.authenticatedPlatformUser = authenticatedUser;
    return true;
  }
}

@Controller('test-platform-authorization')
class TestAuthorizationController {
  @Get()
  @UseGuards(PlatformAuthGuard, PlatformAuthorizationGuard)
  @RequirePermissions('platform.manage')
  read(): { success: true } {
    return { success: true };
  }
}

describe('Platform guard composition HTTP contract', () => {
  let app: NestFastifyApplication;
  const authorization = { hasPermissions: vi.fn() };

  beforeEach(async () => {
    authorization.hasPermissions.mockResolvedValue(false);
    const authorizationGuard = new PlatformAuthorizationGuard(
      new Reflector(),
      authorization as unknown as PlatformAuthorizationService,
    );
    const module = await Test.createTestingModule({
      controllers: [TestAuthorizationController],
      providers: [PlatformAuthorizationGuard],
    })
      .overrideGuard(PlatformAuthGuard)
      .useClass(TestAuthenticationGuard)
      .overrideGuard(PlatformAuthorizationGuard)
      .useValue(authorizationGuard)
      .compile();

    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
    vi.clearAllMocks();
  });

  it('stops unauthenticated requests at the authentication layer with 401', async () => {
    const response = await app.inject({ method: 'GET', url: '/test-platform-authorization' });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: 'AUTH_TOKEN_MISSING' });
    expect(authorization.hasPermissions).not.toHaveBeenCalled();
  });

  it('returns stable 403 after authentication when permission is absent', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/test-platform-authorization',
      headers: { authorization: 'Bearer valid' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'AUTH_FORBIDDEN' });
    expect(authorization.hasPermissions).toHaveBeenCalledWith('trusted-user', ['platform.manage']);
  });

  it('reaches the controller only after both guards allow the request', async () => {
    authorization.hasPermissions.mockResolvedValue(true);

    const response = await app.inject({
      method: 'GET',
      url: '/test-platform-authorization',
      headers: { authorization: 'Bearer valid' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true });
  });
});
