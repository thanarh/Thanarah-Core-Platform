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
import { FeatureController } from '../src/platform-catalog/feature.controller';
import { FeatureService } from '../src/platform-catalog/feature.service';
import { PlanController } from '../src/platform-catalog/plan.controller';
import { PlanService } from '../src/platform-catalog/plan.service';

const planId = 'a3551110-e8a8-4f93-91d8-f0e9e0ff1bd9';
const featureId = 'b04407f4-5b8b-46f4-8e16-8c72def449f2';
const authenticatedUser: AuthenticatedPlatformUser = {
  userId: 'authenticated-tenant-member',
  sessionId: 'trusted-platform-session',
  tokenVersion: 1,
  platformRoleIds: ['untrusted-client-role'],
};
const samplePlan = {
  id: planId,
  key: 'PRO',
  name: 'Professional',
  description: null,
  status: 'ACTIVE',
};
const sampleFeature = {
  id: featureId,
  key: 'REPORTS',
  name: 'Reports',
  description: null,
  status: 'ACTIVE',
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

describe('Platform Plan and Feature HTTP authorization', () => {
  let app: NestFastifyApplication;
  const grantedPermissions = new Set<string>();
  const authorization = {
    hasPermissions: vi.fn(
      (userId: string, required: readonly string[]) =>
        userId === authenticatedUser.userId &&
        required.every((permission) => grantedPermissions.has(permission)),
    ),
  };
  const plans = {
    create: vi.fn(),
    list: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
    changeStatus: vi.fn(),
    listFeatures: vi.fn(),
    attachFeature: vi.fn(),
    updateFeature: vi.fn(),
    detachFeature: vi.fn(),
  };
  const features = {
    create: vi.fn(),
    list: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
    changeStatus: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    grantedPermissions.clear();
    plans.create.mockResolvedValue(samplePlan);
    plans.list.mockResolvedValue({ items: [samplePlan], limit: 50, offset: 0 });
    plans.findById.mockResolvedValue(samplePlan);
    plans.update.mockResolvedValue(samplePlan);
    plans.changeStatus.mockResolvedValue(samplePlan);
    plans.listFeatures.mockResolvedValue([]);
    plans.attachFeature.mockResolvedValue({ planId, featureId, enabled: true });
    plans.updateFeature.mockResolvedValue({ planId, featureId, enabled: false });
    plans.detachFeature.mockResolvedValue({ detached: true });
    features.create.mockResolvedValue(sampleFeature);
    features.list.mockResolvedValue({ items: [sampleFeature], limit: 50, offset: 0 });
    features.findById.mockResolvedValue(sampleFeature);
    features.update.mockResolvedValue(sampleFeature);
    features.changeStatus.mockResolvedValue(sampleFeature);

    const authorizationGuard = new PlatformAuthorizationGuard(
      new Reflector(),
      authorization as unknown as PlatformAuthorizationService,
    );
    const module = await Test.createTestingModule({
      controllers: [PlanController, FeatureController],
      providers: [PlatformAuthGuard, PlatformAuthorizationGuard, PlanService, FeatureService],
    })
      .overrideGuard(PlatformAuthGuard)
      .useClass(TestAuthenticationGuard)
      .overrideGuard(PlatformAuthorizationGuard)
      .useValue(authorizationGuard)
      .overrideProvider(PlanService)
      .useValue(plans)
      .overrideProvider(FeatureService)
      .useValue(features)
      .compile();

    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix(APP_CONSTANTS.apiPrefix);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('requires platform authentication for Plan and Feature reads', async () => {
    const planResponse = await app.inject({ method: 'GET', url: '/api/v1/platform/plans' });
    const featureResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/platform/features',
    });

    expect(planResponse.statusCode).toBe(401);
    expect(featureResponse.statusCode).toBe(401);
    expect(authorization.hasPermissions).not.toHaveBeenCalled();
  });

  it('does not treat tenant permissions as platform catalog permissions', async () => {
    grantedPermissions.add('tenant.facilities.read');
    const planResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/platform/plans',
      headers: { authorization: 'Bearer valid' },
    });
    const planWriteResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/platform/plans',
      headers: { authorization: 'Bearer valid' },
      payload: { key: 'PRO', name: 'Professional' },
    });
    const featureResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/platform/features',
      headers: { authorization: 'Bearer valid' },
      payload: { key: 'REPORTS', name: 'Reports' },
    });

    expect(planResponse.statusCode).toBe(403);
    expect(planWriteResponse.statusCode).toBe(403);
    expect(featureResponse.statusCode).toBe(403);
    expect(plans.list).not.toHaveBeenCalled();
    expect(plans.create).not.toHaveBeenCalled();
    expect(features.create).not.toHaveBeenCalled();
    expect(authorization.hasPermissions).toHaveBeenNthCalledWith(1, authenticatedUser.userId, [
      'plans.read',
    ]);
    expect(authorization.hasPermissions).toHaveBeenNthCalledWith(2, authenticatedUser.userId, [
      'plans.manage',
    ]);
    expect(authorization.hasPermissions).toHaveBeenNthCalledWith(3, authenticatedUser.userId, [
      'features.manage',
    ]);
  });

  it('requires the narrow platform management permission for writes', async () => {
    grantedPermissions.add('plans.read');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/platform/plans',
      headers: { authorization: 'Bearer valid' },
      payload: { key: 'PRO', name: 'Professional' },
    });

    expect(response.statusCode).toBe(403);
    expect(plans.create).not.toHaveBeenCalled();
    expect(authorization.hasPermissions).toHaveBeenCalledWith(authenticatedUser.userId, [
      'plans.manage',
    ]);
  });

  it('does not let client role or permission headers escalate an authenticated user', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/platform/plans',
      headers: {
        authorization: 'Bearer valid',
        'x-platform-role': 'OWNER',
        'x-platform-permissions': 'plans.manage',
      },
      payload: { key: 'PRO', name: 'Professional' },
    });

    expect(response.statusCode).toBe(403);
    expect(plans.create).not.toHaveBeenCalled();
  });

  it('allows an authorized platform administrator and ignores client role/permission claims', async () => {
    grantedPermissions.add('plans.manage');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/platform/plans',
      headers: {
        authorization: 'Bearer valid',
        'x-platform-role': 'OWNER',
        'x-platform-permissions': 'plans.manage',
      },
      payload: { key: 'PRO', name: 'Professional' },
    });

    expect(response.statusCode).toBe(201);
    expect(plans.create).toHaveBeenCalledWith(
      { key: 'PRO', name: 'Professional' },
      authenticatedUser,
      expect.any(Object),
    );
    expect(response.json()).toMatchObject({ id: planId, key: 'PRO' });
  });

  it('does not allow tenantId or client-controlled authorization fields in catalog input', async () => {
    grantedPermissions.add('plans.manage');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/platform/plans',
      headers: { authorization: 'Bearer valid' },
      payload: {
        key: 'PRO',
        name: 'Professional',
        tenantId: 'tenant-a',
        actorUserId: 'attacker',
        role: 'OWNER',
        permissions: ['plans.manage'],
        status: 'ARCHIVED',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(plans.create).not.toHaveBeenCalled();
  });

  it('uses the dedicated Plan Feature permission and accepts only a catalog Feature ID', async () => {
    grantedPermissions.add('plan_features.manage');
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/platform/plans/${planId}/features`,
      headers: { authorization: 'Bearer valid' },
      payload: { featureId },
    });

    expect(response.statusCode).toBe(201);
    expect(plans.attachFeature).toHaveBeenCalledWith(
      planId,
      featureId,
      authenticatedUser,
      expect.any(Object),
    );
    expect(authorization.hasPermissions).toHaveBeenCalledWith(authenticatedUser.userId, [
      'plan_features.manage',
    ]);
  });

  it('does not expose physical Plan or Feature deletion endpoints', async () => {
    grantedPermissions.add('plans.manage');
    grantedPermissions.add('features.manage');
    const planResponse = await app.inject({
      method: 'DELETE',
      url: `/api/v1/platform/plans/${planId}`,
      headers: { authorization: 'Bearer valid' },
    });
    const featureResponse = await app.inject({
      method: 'DELETE',
      url: `/api/v1/platform/features/${featureId}`,
      headers: { authorization: 'Bearer valid' },
    });

    expect(planResponse.statusCode).toBe(404);
    expect(featureResponse.statusCode).toBe(404);
  });

  it('publishes validated catalog bodies, filters, and UUID path parameters in OpenAPI', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Thanarah Test').setVersion('1.0').build(),
    );
    const planCreateBody =
      document.paths['/api/v1/platform/plans']?.post?.requestBody?.content?.['application/json']
        ?.schema;
    const attachFeatureBody =
      document.paths['/api/v1/platform/plans/{planId}/features']?.post?.requestBody?.content?.[
        'application/json'
      ]?.schema;
    const updatePlanFeatureBody =
      document.paths['/api/v1/platform/plans/{planId}/features/{featureId}']?.patch?.requestBody
        ?.content?.['application/json']?.schema;
    const planIdParameter = document.paths['/api/v1/platform/plans/{planId}']?.get?.parameters;
    const planListParameters = document.paths['/api/v1/platform/plans']?.get?.parameters;

    expect(planCreateBody).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['key', 'name'],
      properties: {
        key: { type: 'string', maxLength: 64 },
        name: { type: 'string', maxLength: 191 },
      },
    });
    expect(attachFeatureBody).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['featureId'],
      properties: { featureId: { type: 'string', format: 'uuid' } },
    });
    expect(updatePlanFeatureBody).toMatchObject({
      type: 'object',
      additionalProperties: false,
      anyOf: [{ required: ['enabled'] }, { required: ['quotaLimits'] }],
      properties: {
        enabled: { type: 'boolean' },
        quotaLimits: {
          type: 'object',
          nullable: true,
          additionalProperties: false,
          properties: {
            BRANCHES: { oneOf: expect.any(Array) },
          },
        },
      },
    });
    expect(planIdParameter).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'planId',
          in: 'path',
          schema: { type: 'string', format: 'uuid' },
        }),
      ]),
    );
    expect(planListParameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'status', in: 'query' }),
        expect.objectContaining({ name: 'limit', in: 'query' }),
        expect.objectContaining({ name: 'offset', in: 'query' }),
      ]),
    );
  });
});
