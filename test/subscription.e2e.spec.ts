import { type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedPlatformUser } from '../src/auth/auth.types';
import { AuthenticationError } from '../src/auth/errors/auth.errors';
import { PlatformAuthGuard } from '../src/auth/guards/platform-auth.guard';
import { PlatformAuthorizationGuard } from '../src/auth/guards/platform-authorization.guard';
import type { PlatformAuthorizationService } from '../src/auth/services/platform-authorization.service';
import { APP_CONSTANTS } from '../src/common/constants/app.constants';
import { SubscriptionController } from '../src/subscriptions/subscription.controller';
import { SubscriptionService } from '../src/subscriptions/subscription.service';

const tenantId = '11111111-1111-4111-8111-111111111111';
const planId = '22222222-2222-4222-8222-222222222222';
const subscriptionId = '33333333-3333-4333-8333-333333333333';
const authenticatedUser: AuthenticatedPlatformUser = {
  userId: '44444444-4444-4444-8444-444444444444',
  sessionId: '55555555-5555-4555-8555-555555555555',
  tokenVersion: 1,
  platformRoleIds: ['untrusted-client-role'],
};
const sampleSubscription = {
  id: subscriptionId,
  tenantId,
  planId,
  status: 'ACTIVE',
  effectiveStatus: 'ACTIVE',
  startsAt: new Date('2026-10-01T00:00:00.000Z'),
  endsAt: new Date('2026-11-01T00:00:00.000Z'),
  cancelledAt: null,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-01T00:00:00.000Z'),
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

describe('Platform Subscription administration HTTP contract', () => {
  let app: NestFastifyApplication;
  const grantedPermissions = new Set<string>();
  const authorization = {
    hasPermissions: vi.fn(
      (userId: string, required: readonly string[]) =>
        userId === authenticatedUser.userId &&
        required.every((permission) => grantedPermissions.has(permission)),
    ),
  };
  const subscriptions = {
    create: vi.fn(),
    list: vi.fn(),
    findCurrentForTenant: vi.fn(),
    findById: vi.fn(),
    activate: vi.fn(),
    suspend: vi.fn(),
    cancel: vi.fn(),
    expire: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    grantedPermissions.clear();
    subscriptions.create.mockResolvedValue(sampleSubscription);
    subscriptions.list.mockResolvedValue({ items: [sampleSubscription], limit: 50, offset: 0 });
    subscriptions.findCurrentForTenant.mockResolvedValue(sampleSubscription);
    subscriptions.findById.mockResolvedValue(sampleSubscription);
    subscriptions.activate.mockResolvedValue(sampleSubscription);
    subscriptions.suspend.mockResolvedValue(sampleSubscription);
    subscriptions.cancel.mockResolvedValue(sampleSubscription);
    subscriptions.expire.mockResolvedValue(sampleSubscription);

    const authorizationGuard = new PlatformAuthorizationGuard(
      new Reflector(),
      authorization as unknown as PlatformAuthorizationService,
    );
    const module = await Test.createTestingModule({
      controllers: [SubscriptionController],
      providers: [PlatformAuthGuard, PlatformAuthorizationGuard, SubscriptionService],
    })
      .overrideGuard(PlatformAuthGuard)
      .useClass(TestAuthenticationGuard)
      .overrideGuard(PlatformAuthorizationGuard)
      .useValue(authorizationGuard)
      .overrideProvider(SubscriptionService)
      .useValue(subscriptions)
      .compile();

    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix(APP_CONSTANTS.apiPrefix);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('requires platform authentication before reads or writes', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/platform/subscriptions',
    });
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/platform/subscriptions',
      payload: { tenantId, planId, startsAt: '2026-10-01T00:00:00.000Z' },
    });

    expect(list.statusCode).toBe(401);
    expect(create.statusCode).toBe(401);
    expect(authorization.hasPermissions).not.toHaveBeenCalled();
  });

  it('does not let tenant permissions substitute for platform subscription permissions', async () => {
    grantedPermissions.add('tenant.facilities.read');
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/platform/subscriptions',
      headers: { authorization: 'Bearer valid' },
    });
    const write = await app.inject({
      method: 'POST',
      url: '/api/v1/platform/subscriptions',
      headers: { authorization: 'Bearer valid' },
      payload: { tenantId, planId, startsAt: '2026-10-01T00:00:00.000Z' },
    });

    expect(list.statusCode).toBe(403);
    expect(write.statusCode).toBe(403);
    expect(subscriptions.list).not.toHaveBeenCalled();
    expect(subscriptions.create).not.toHaveBeenCalled();
    expect(authorization.hasPermissions).toHaveBeenNthCalledWith(1, authenticatedUser.userId, [
      'subscriptions.read',
    ]);
    expect(authorization.hasPermissions).toHaveBeenNthCalledWith(2, authenticatedUser.userId, [
      'subscriptions.manage',
    ]);
  });

  it('separates read and mutation permissions', async () => {
    grantedPermissions.add('subscriptions.read');
    const deniedWrite = await app.inject({
      method: 'POST',
      url: '/api/v1/platform/subscriptions',
      headers: { authorization: 'Bearer valid' },
      payload: { tenantId, planId, startsAt: '2026-10-01T00:00:00.000Z' },
    });
    expect(deniedWrite.statusCode).toBe(403);

    grantedPermissions.clear();
    grantedPermissions.add('subscriptions.manage');
    const deniedRead = await app.inject({
      method: 'GET',
      url: '/api/v1/platform/subscriptions',
      headers: { authorization: 'Bearer valid' },
    });
    expect(deniedRead.statusCode).toBe(403);
    expect(subscriptions.create).not.toHaveBeenCalled();
    expect(subscriptions.list).not.toHaveBeenCalled();
  });

  it('ignores client-supplied roles and permission claims', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/platform/subscriptions',
      headers: {
        authorization: 'Bearer valid',
        'x-platform-role': 'OWNER',
        'x-platform-permissions': 'subscriptions.manage',
      },
      payload: { tenantId, planId, startsAt: '2026-10-01T00:00:00.000Z' },
    });

    expect(response.statusCode).toBe(403);
    expect(subscriptions.create).not.toHaveBeenCalled();
  });

  it('allows only the platform management permission and forwards trusted actor/context', async () => {
    grantedPermissions.add('subscriptions.manage');
    const payload = { tenantId, planId, startsAt: '2026-10-01T00:00:00.000Z' };
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/platform/subscriptions',
      headers: {
        authorization: 'Bearer valid',
        'x-request-id': 'subscription-request',
        'user-agent': 'subscription-http-test',
      },
      payload,
    });

    expect(response.statusCode).toBe(201);
    expect(subscriptions.create).toHaveBeenCalledWith(
      payload,
      authenticatedUser,
      expect.objectContaining({
        requestId: 'subscription-request',
        ipAddress: expect.any(String),
        userAgent: 'subscription-http-test',
      }),
    );
    expect(response.json()).toMatchObject({
      id: subscriptionId,
      tenantId,
      planId,
      effectiveStatus: 'ACTIVE',
    });
  });

  it('rejects arbitrary client lifecycle state and hidden ownership fields', async () => {
    grantedPermissions.add('subscriptions.manage');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/platform/subscriptions',
      headers: { authorization: 'Bearer valid' },
      payload: {
        tenantId,
        planId,
        startsAt: '2026-10-01T00:00:00.000Z',
        status: 'CANCELLED',
        actorUserId: 'attacker',
        permissions: ['subscriptions.manage'],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(subscriptions.create).not.toHaveBeenCalled();
  });

  it('serves current subscriptions through the read-only platform route', async () => {
    grantedPermissions.add('subscriptions.read');
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/platform/subscriptions/current?tenantId=${tenantId}`,
      headers: { authorization: 'Bearer valid' },
    });

    expect(response.statusCode).toBe(200);
    expect(subscriptions.findCurrentForTenant).toHaveBeenCalledWith(tenantId);
    expect(subscriptions.activate).not.toHaveBeenCalled();
  });

  it('validates Subscription UUID paths before calling a lifecycle operation', async () => {
    grantedPermissions.add('subscriptions.manage');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/platform/subscriptions/not-a-uuid/cancel',
      headers: { authorization: 'Bearer valid' },
    });

    expect(response.statusCode).toBe(400);
    expect(subscriptions.cancel).not.toHaveBeenCalled();
  });

  it('requires the mutation permission for cancellation and exposes no physical delete route', async () => {
    const denied = await app.inject({
      method: 'POST',
      url: `/api/v1/platform/subscriptions/${subscriptionId}/cancel`,
      headers: { authorization: 'Bearer valid' },
    });
    grantedPermissions.add('subscriptions.manage');
    const cancelled = await app.inject({
      method: 'POST',
      url: `/api/v1/platform/subscriptions/${subscriptionId}/cancel`,
      headers: { authorization: 'Bearer valid' },
    });
    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/platform/subscriptions/${subscriptionId}`,
      headers: { authorization: 'Bearer valid' },
    });

    expect(denied.statusCode).toBe(403);
    expect(cancelled.statusCode).toBe(200);
    expect(subscriptions.cancel).toHaveBeenCalledWith(
      subscriptionId,
      authenticatedUser,
      expect.any(Object),
    );
    expect(deleted.statusCode).toBe(404);
  });

  it('documents all operations, response schemas, request bodies, UUIDs, security, and permissions in OpenAPI', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Thanarah Test').setVersion('1.0').addBearerAuth().build(),
    );
    const basePath = '/api/v1/platform/subscriptions';
    const create = document.paths[basePath]?.post;
    const list = document.paths[basePath]?.get;
    const current = document.paths[`${basePath}/current`]?.get;
    const find = document.paths[`${basePath}/{subscriptionId}`]?.get;
    const cancel = document.paths[`${basePath}/{subscriptionId}/cancel`]?.post;

    expect(create?.requestBody?.content?.['application/json']?.schema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['tenantId', 'planId', 'startsAt'],
      properties: {
        tenantId: { type: 'string', format: 'uuid' },
        planId: { type: 'string', format: 'uuid' },
        startsAt: { type: 'string', format: 'date-time' },
      },
    });
    const createBodySchema = create?.requestBody?.content?.['application/json']?.schema as {
      properties?: { endsAt?: Record<string, unknown> };
    };
    expect(createBodySchema.properties?.endsAt).not.toHaveProperty('nullable');
    expect(create?.responses['201']?.content?.['application/json']?.schema).toMatchObject({
      type: 'object',
      properties: {
        effectiveStatus: { enum: ['ACTIVE', 'SCHEDULED', 'SUSPENDED', 'CANCELLED', 'EXPIRED'] },
      },
    });
    expect(create?.responses['401']?.content?.['application/json']?.schema).toMatchObject({
      properties: {
        error: {
          properties: { code: { type: 'string' }, message: { type: 'string' } },
        },
      },
    });
    expect(create?.security).toEqual([{ bearer: [] }]);
    expect(create?.description).toContain('subscriptions.manage');
    expect(list?.description).toContain('subscriptions.read');
    expect(list?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'tenantId',
          in: 'query',
          schema: { type: 'string', format: 'uuid' },
        }),
      ]),
    );
    expect(current?.parameters).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'tenantId', required: true })]),
    );
    expect(find?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'subscriptionId',
          in: 'path',
          schema: { type: 'string', format: 'uuid' },
        }),
      ]),
    );
    expect(cancel?.responses).toHaveProperty('409');
    expect(cancel?.description).toContain('subscriptions.manage');
  });
});
