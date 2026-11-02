import {
  Controller,
  HttpCode,
  Post,
  type CanActivate,
  type ExecutionContext,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedPlatformUser } from '../src/auth/auth.types';
import { AuthenticationError } from '../src/auth/errors/auth.errors';
import { PlatformAuthGuard } from '../src/auth/guards/platform-auth.guard';
import { APP_CONSTANTS } from '../src/common/constants/app.constants';
import { TenantAuthorizationGuard } from '../src/tenant/tenant-authorization.guard';
import { TenantPermissionDeniedError } from '../src/tenant/tenant-authorization.errors';
import type { TenantAuthorizationService } from '../src/tenant/tenant-authorization.service';
import {
  TenantContextInvalidError,
  type TenantId,
  type TenantMembershipId,
  type TrustedTenantContext,
  type ValidatedTenantMembership,
} from '../src/tenant/tenant-context.contract';
import { CurrentTenantContext } from '../src/tenant/tenant-current-context.decorator';
import { TenantContextGuard } from '../src/tenant/tenant-context.guard';
import {
  TenantMembershipValidatorService,
  TrustedTenantContextFactoryService,
} from '../src/tenant/tenant-context.service';
import { TenantEntitlementGuard } from '../src/tenant/tenant-entitlement.guard';
import { TenantFeatureNotIncludedError } from '../src/tenant/tenant-entitlement.errors';
import type { TenantEntitlementService } from '../src/tenant/tenant-entitlement.service';
import { RequireTenantFeature } from '../src/tenant/tenant-require-feature.decorator';
import { RequireTenantPermissions } from '../src/tenant/tenant-require-permissions.decorator';
import type { FastifyRequest } from 'fastify';

const tenantId = '11111111-1111-4111-8111-111111111111';
const otherTenantId = '99999999-9999-4999-8999-999999999999';
const membershipId = '22222222-2222-4222-8222-222222222222';
const platformUserId = '33333333-3333-4333-8333-333333333333';
const planId = '44444444-4444-4444-8444-444444444444';
const user: AuthenticatedPlatformUser = {
  userId: platformUserId,
  sessionId: '55555555-5555-4555-8555-555555555555',
  tokenVersion: 1,
  platformRoleIds: [],
};
const validatedMembership = {
  tenantId: tenantId as TenantId,
  membershipId: membershipId as TenantMembershipId,
  platformUserId,
} as ValidatedTenantMembership;
const route = `/api/tenant-entitlement-contract/${tenantId}`;

class TestAuthenticationGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (request.headers.authorization !== 'Bearer valid') {
      throw new AuthenticationError('AUTH_TOKEN_MISSING', 'Authorization token is required');
    }
    request.authenticatedPlatformUser = user;
    return true;
  }
}

@Controller('tenant-entitlement-contract/:tenantId')
@UseGuards(PlatformAuthGuard, TenantContextGuard, TenantAuthorizationGuard, TenantEntitlementGuard)
@RequireTenantPermissions('tenant.branches.read')
class TenantEntitlementContractController {
  @Post()
  @HttpCode(200)
  @RequireTenantFeature('APPOINTMENTS')
  probe(@CurrentTenantContext() _context: TrustedTenantContext): { success: true } {
    return { success: true };
  }

  @Post('without-feature')
  @HttpCode(200)
  missingFeatureMetadata(): { success: true } {
    return { success: true };
  }
}

describe('Tenant entitlement authorization composition HTTP contract', () => {
  let app: NestFastifyApplication;
  const validator = { validateMembership: vi.fn() };
  const authorization = { authorize: vi.fn() };
  const entitlements = { requireFeature: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    validator.validateMembership.mockResolvedValue(validatedMembership);
    authorization.authorize.mockResolvedValue(undefined);
    entitlements.requireFeature.mockResolvedValue(undefined);

    const contextGuard = new TenantContextGuard(
      validator as unknown as TenantMembershipValidatorService,
      new TrustedTenantContextFactoryService(),
    );
    const authorizationGuard = new TenantAuthorizationGuard(
      new Reflector(),
      authorization as unknown as TenantAuthorizationService,
    );
    const entitlementGuard = new TenantEntitlementGuard(
      new Reflector(),
      entitlements as unknown as TenantEntitlementService,
    );

    const module = await Test.createTestingModule({
      controllers: [TenantEntitlementContractController],
      providers: [TenantContextGuard, TenantAuthorizationGuard, TenantEntitlementGuard],
    })
      .overrideGuard(PlatformAuthGuard)
      .useClass(TestAuthenticationGuard)
      .overrideGuard(TenantContextGuard)
      .useValue(contextGuard)
      .overrideGuard(TenantAuthorizationGuard)
      .useValue(authorizationGuard)
      .overrideGuard(TenantEntitlementGuard)
      .useValue(entitlementGuard)
      .compile();

    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix(APP_CONSTANTS.apiPrefix);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  const validHeaders = { authorization: 'Bearer valid' };

  it('returns 401 before tenant or entitlement checks when unauthenticated', async () => {
    const response = await app.inject({ method: 'POST', url: route });

    expect(response.statusCode).toBe(401);
    expect(validator.validateMembership).not.toHaveBeenCalled();
    expect(authorization.authorize).not.toHaveBeenCalled();
    expect(entitlements.requireFeature).not.toHaveBeenCalled();
  });

  it('requires an active membership before checking authorization or entitlement', async () => {
    validator.validateMembership.mockRejectedValueOnce(new TenantContextInvalidError());

    const response = await app.inject({ method: 'POST', url: route, headers: validHeaders });

    expect(response.statusCode).toBe(403);
    expect(authorization.authorize).not.toHaveBeenCalled();
    expect(entitlements.requireFeature).not.toHaveBeenCalled();
  });

  it('returns 403 when tenant permission fails even if entitlement would pass', async () => {
    authorization.authorize.mockRejectedValueOnce(new TenantPermissionDeniedError());

    const response = await app.inject({ method: 'POST', url: route, headers: validHeaders });

    expect(response.statusCode).toBe(403);
    expect(entitlements.requireFeature).not.toHaveBeenCalled();
  });

  it('returns 403 when permission passes but the required Feature is not included', async () => {
    entitlements.requireFeature.mockRejectedValueOnce(new TenantFeatureNotIncludedError());

    const response = await app.inject({ method: 'POST', url: route, headers: validHeaders });

    expect(response.statusCode).toBe(403);
    expect(authorization.authorize).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ tenantId }),
      'tenant.branches.read',
    );
    expect(entitlements.requireFeature).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ tenantId }),
      'APPOINTMENTS',
    );
    expect(response.json()).toMatchObject({ code: 'FEATURE_NOT_INCLUDED' });
  });

  it('succeeds only after both tenant permission and server-defined entitlement pass', async () => {
    const response = await app.inject({ method: 'POST', url: route, headers: validHeaders });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true });
    expect(authorization.authorize).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ tenantId }),
      'tenant.branches.read',
    );
    expect(entitlements.requireFeature).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ tenantId }),
      'APPOINTMENTS',
    );
  });

  it('ignores client tenant, plan, feature, and entitlement claims', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `${route}?tenantId=${otherTenantId}&planId=${planId}&featureKey=CLIENT_QUERY_FEATURE`,
      headers: {
        ...validHeaders,
        'x-feature-key': 'CLIENT_HEADER_FEATURE',
        'x-plan-id': planId,
      },
      payload: {
        tenantId: otherTenantId,
        planId,
        featureId: '66666666-6666-4666-8666-666666666666',
        featureKey: 'CLIENT_BODY_FEATURE',
        entitled: true,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(validator.validateMembership).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ tenantIdCandidate: tenantId }),
    );
    expect(entitlements.requireFeature).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ tenantId, membershipId, platformUserId }),
      'APPOINTMENTS',
    );
  });

  it('rejects a mismatched route tenant instead of switching trusted scope', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/tenant-entitlement-contract/${otherTenantId}`,
      headers: validHeaders,
    });

    expect(response.statusCode).toBe(403);
    expect(entitlements.requireFeature).not.toHaveBeenCalled();
  });

  it('fails closed when a route has tenant authorization but no feature metadata', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `${route}/without-feature`,
      headers: validHeaders,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'TENANT_FEATURE_REQUIREMENT_MISSING' });
    expect(entitlements.requireFeature).not.toHaveBeenCalled();
  });

  it('does not call entitlement when both authorization and entitlement would deny', async () => {
    authorization.authorize.mockRejectedValueOnce(new TenantPermissionDeniedError());
    entitlements.requireFeature.mockRejectedValueOnce(new TenantFeatureNotIncludedError());

    const response = await app.inject({ method: 'POST', url: route, headers: validHeaders });

    expect(response.statusCode).toBe(403);
    expect(entitlements.requireFeature).not.toHaveBeenCalled();
  });
});
