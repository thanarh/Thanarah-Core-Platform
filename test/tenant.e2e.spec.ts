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
import { TenantStatus } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedPlatformUser } from '../src/auth/auth.types';
import { RequirePermissions } from '../src/auth/decorators/require-permissions.decorator';
import { AuthenticationError } from '../src/auth/errors/auth.errors';
import { PlatformAuthGuard } from '../src/auth/guards/platform-auth.guard';
import { PlatformAuthorizationGuard } from '../src/auth/guards/platform-authorization.guard';
import type { PlatformAuthorizationService } from '../src/auth/services/platform-authorization.service';
import { APP_CONSTANTS } from '../src/common/constants/app.constants';
import { TenantController } from '../src/tenant/tenant.controller';
import { TenantService } from '../src/tenant/tenant.service';

const authenticatedUser: AuthenticatedPlatformUser = {
  userId: 'trusted-platform-user',
  sessionId: 'trusted-platform-session',
  tokenVersion: 1,
  platformRoleIds: [],
};

const sampleTenant = {
  id: '88c97293-0825-4c6e-b75e-72aee285d195',
  slug: 'north-clinic',
  legalName: 'North Health Group',
  displayName: 'North Health Group',
  status: TenantStatus.ACTIVE,
  statusChangedAt: new Date('2026-10-05T12:00:00.000Z'),
  suspendedAt: null,
  deactivatedAt: null,
  createdAt: new Date('2026-10-05T12:00:00.000Z'),
  updatedAt: new Date('2026-10-05T12:00:00.000Z'),
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

@Controller('tenant-guard-probe')
class TenantGuardProbeController {
  @Get()
  @UseGuards(PlatformAuthGuard, PlatformAuthorizationGuard)
  @RequirePermissions('platform.manage')
  probe(): { success: true } {
    return { success: true };
  }
}

describe('Tenant administration HTTP security boundary', () => {
  let app: NestFastifyApplication;
  const authorization = { hasPermissions: vi.fn() };
  const tenantService = {
    create: vi.fn(),
    list: vi.fn(),
    findById: vi.fn(),
    changeStatus: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    authorization.hasPermissions.mockResolvedValue(false);
    tenantService.create.mockResolvedValue(sampleTenant);
    tenantService.list.mockResolvedValue({ items: [sampleTenant], limit: 50, offset: 0 });
    tenantService.findById.mockResolvedValue(sampleTenant);
    tenantService.changeStatus.mockResolvedValue(sampleTenant);

    const authorizationGuard = new PlatformAuthorizationGuard(
      new Reflector(),
      authorization as unknown as PlatformAuthorizationService,
    );
    const module = await Test.createTestingModule({
      controllers: [TenantController, TenantGuardProbeController],
      providers: [PlatformAuthorizationGuard, TenantService],
    })
      .overrideGuard(PlatformAuthGuard)
      .useClass(TestAuthenticationGuard)
      .overrideGuard(PlatformAuthorizationGuard)
      .useValue(authorizationGuard)
      .overrideProvider(TenantService)
      .useValue(tenantService)
      .compile();

    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix(APP_CONSTANTS.apiPrefix);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('requires platform authentication for tenant creation', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/platform/tenants',
      payload: { slug: 'north-clinic', legalName: 'North Health Group' },
    });

    expect(response.statusCode).toBe(401);
    expect(authorization.hasPermissions).not.toHaveBeenCalled();
    expect(tenantService.create).not.toHaveBeenCalled();
  });

  it('requires platform.manage and does not authorize from a tenant ID', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/platform/tenants',
      headers: { authorization: 'Bearer valid' },
      payload: { slug: 'north-clinic', legalName: 'North Health Group' },
    });
    const tenantIdResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/platform/tenants/${sampleTenant.id}`,
      headers: { authorization: 'Bearer valid' },
    });

    expect(response.statusCode).toBe(403);
    expect(tenantIdResponse.statusCode).toBe(403);
    expect(authorization.hasPermissions).toHaveBeenNthCalledWith(1, authenticatedUser.userId, [
      'platform.manage',
    ]);
    expect(authorization.hasPermissions).toHaveBeenNthCalledWith(2, authenticatedUser.userId, [
      'platform.read',
    ]);
    expect(tenantService.create).not.toHaveBeenCalled();
    expect(tenantService.findById).not.toHaveBeenCalled();
  });

  it('uses only server-authenticated actor context and rejects mass-assigned fields', async () => {
    authorization.hasPermissions.mockResolvedValue(true);
    const invalidResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/platform/tenants',
      headers: { authorization: 'Bearer valid' },
      payload: {
        slug: 'north-clinic',
        legalName: 'North Health Group',
        actorUserId: 'attacker',
        status: 'DEACTIVATED',
      },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/platform/tenants',
      headers: { authorization: 'Bearer valid' },
      payload: { slug: ' North---Clinic ', legalName: ' North   Health Group ' },
    });

    expect(invalidResponse.statusCode).toBe(400);
    expect(tenantService.create).toHaveBeenCalledTimes(1);
    expect(tenantService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'north-clinic',
        legalName: 'North Health Group',
      }),
      authenticatedUser,
      expect.any(Object),
    );
    expect(response.statusCode).toBe(201);
  });

  it('requires the existing platform.manage permission on administrative guard routes', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/tenant-guard-probe',
      headers: { authorization: 'Bearer valid' },
    });

    expect(response.statusCode).toBe(403);
    expect(authorization.hasPermissions).toHaveBeenCalledWith(authenticatedUser.userId, [
      'platform.manage',
    ]);
  });
});
