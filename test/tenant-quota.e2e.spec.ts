import {
  Controller,
  HttpCode,
  Inject,
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
import { TenantFeatureNotIncludedError } from '../src/tenant/tenant-entitlement.errors';
import type { TenantEntitlementService } from '../src/tenant/tenant-entitlement.service';
import { TenantQuotaExceededError } from '../src/tenant/tenant-quota.errors';
import type { TenantQuotaRepository } from '../src/tenant/tenant-quota.repository';
import { TenantQuotaService } from '../src/tenant/tenant-quota.service';
import { RequireTenantPermissions } from '../src/tenant/tenant-require-permissions.decorator';
import type { FastifyRequest } from 'fastify';

const tenantId = '11111111-1111-4111-8111-111111111111';
const otherTenantId = '99999999-9999-4999-8999-999999999999';
const membershipId = '22222222-2222-4222-8222-222222222222';
const platformUserId = '33333333-3333-4333-8333-333333333333';
const currentPlanId = '44444444-4444-4444-8444-444444444444';
const currentFeatureId = '66666666-6666-4666-8666-666666666666';
const user: AuthenticatedPlatformUser = {
  userId: platformUserId,
  sessionId: '55555555-5555-4555-8555-555555555555',
  tokenVersion: 1,
  platformRoleIds: ['platform-owner-role-id'],
};
const validatedMembership = {
  tenantId: tenantId as TenantId,
  membershipId: membershipId as TenantMembershipId,
  platformUserId,
} as ValidatedTenantMembership;
const route = `/api/tenant-quota-contract/${tenantId}`;

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

class TestQuotaUsageSource {
  currentUsage = 1;
}

@Controller('tenant-quota-contract/:tenantId')
@UseGuards(PlatformAuthGuard, TenantContextGuard, TenantAuthorizationGuard)
@RequireTenantPermissions('tenant.branches.read')
class TenantQuotaContractController {
  constructor(
    @Inject(TenantQuotaService) private readonly quotas: TenantQuotaService,
    @Inject(TestQuotaUsageSource) private readonly usage: TestQuotaUsageSource,
  ) {}

  @Post()
  @HttpCode(200)
  async check(@CurrentTenantContext() context: TrustedTenantContext): Promise<{ outcome: string }> {
    const decision = await this.quotas.checkQuota(context, {
      featureKey: 'APPOINTMENTS',
      resourceKey: 'BRANCHES',
      currentUsage: this.usage.currentUsage,
    });
    if (decision.outcome === 'EXCEEDED') throw new TenantQuotaExceededError();
    if (decision.outcome === 'NOT_ENTITLED' || decision.outcome === 'NO_SUBSCRIPTION') {
      throw new TenantFeatureNotIncludedError();
    }
    return { outcome: decision.outcome };
  }
}

describe('Tenant quota authorization composition HTTP contract', () => {
  let app: NestFastifyApplication;
  const validator = { validateMembership: vi.fn() };
  const authorization = { authorize: vi.fn() };
  const entitlements = { resolve: vi.fn() };
  const quotas = { findActivePlanFeatureQuotaLimits: vi.fn() };
  const usage = new TestQuotaUsageSource();

  beforeEach(async () => {
    vi.clearAllMocks();
    usage.currentUsage = 1;
    validator.validateMembership.mockResolvedValue(validatedMembership);
    authorization.authorize.mockResolvedValue(undefined);
    entitlements.resolve.mockResolvedValue({
      outcome: 'ENTITLED',
      entitled: true,
      featureKey: 'APPOINTMENTS',
      subscriptionId: 'current-subscription',
      planId: currentPlanId,
      featureId: currentFeatureId,
    });
    quotas.findActivePlanFeatureQuotaLimits.mockResolvedValue({
      kind: 'ready',
      quotaLimits: { BRANCHES: { type: 'COUNT', max: 2 } },
    });

    const contextGuard = new TenantContextGuard(
      validator as unknown as TenantMembershipValidatorService,
      new TrustedTenantContextFactoryService(),
    );
    const authorizationGuard = new TenantAuthorizationGuard(
      new Reflector(),
      authorization as unknown as TenantAuthorizationService,
    );
    const quotaService = new TenantQuotaService(
      entitlements as unknown as TenantEntitlementService,
      quotas as unknown as TenantQuotaRepository,
    );

    const module = await Test.createTestingModule({
      controllers: [TenantQuotaContractController],
      providers: [
        PlatformAuthGuard,
        TenantContextGuard,
        TenantAuthorizationGuard,
        { provide: TenantQuotaService, useValue: quotaService },
        { provide: TestQuotaUsageSource, useValue: usage },
      ],
    })
      .overrideGuard(PlatformAuthGuard)
      .useClass(TestAuthenticationGuard)
      .overrideGuard(TenantContextGuard)
      .useValue(contextGuard)
      .overrideGuard(TenantAuthorizationGuard)
      .useValue(authorizationGuard)
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

  it('rejects unauthenticated requests before context, permission, entitlement, or quota checks', async () => {
    const response = await app.inject({ method: 'POST', url: route });

    expect(response.statusCode).toBe(401);
    expect(validator.validateMembership).not.toHaveBeenCalled();
    expect(authorization.authorize).not.toHaveBeenCalled();
    expect(entitlements.resolve).not.toHaveBeenCalled();
    expect(quotas.findActivePlanFeatureQuotaLimits).not.toHaveBeenCalled();
  });

  it('fails closed for invalid tenant membership before permission or quota checks', async () => {
    validator.validateMembership.mockRejectedValueOnce(new TenantContextInvalidError());

    const response = await app.inject({ method: 'POST', url: route, headers: validHeaders });

    expect(response.statusCode).toBe(403);
    expect(authorization.authorize).not.toHaveBeenCalled();
    expect(entitlements.resolve).not.toHaveBeenCalled();
  });

  it('requires tenant permission even when entitlement and quota would pass', async () => {
    authorization.authorize.mockRejectedValueOnce(new TenantPermissionDeniedError());

    const response = await app.inject({
      method: 'POST',
      url: route,
      headers: validHeaders,
      payload: { currentUsage: 0, resourceKey: 'CLIENT_RESOURCE', featureKey: 'CLIENT_FEATURE' },
    });

    expect(response.statusCode).toBe(403);
    expect(entitlements.resolve).not.toHaveBeenCalled();
    expect(quotas.findActivePlanFeatureQuotaLimits).not.toHaveBeenCalled();
  });

  it('requires entitlement even when the configured quota would pass', async () => {
    entitlements.resolve.mockResolvedValueOnce({
      outcome: 'NOT_ENTITLED',
      entitled: false,
      reason: 'NOT_ENTITLED_PLAN_FEATURE',
      featureKey: 'APPOINTMENTS',
    });

    const response = await app.inject({ method: 'POST', url: route, headers: validHeaders });

    expect(response.statusCode).toBe(403);
    expect(quotas.findActivePlanFeatureQuotaLimits).not.toHaveBeenCalled();
  });

  it('rejects an exceeded quota without returning usage or limit values', async () => {
    usage.currentUsage = 2;

    const response = await app.inject({ method: 'POST', url: route, headers: validHeaders });
    const body = response.json() as Record<string, unknown>;

    expect(response.statusCode).toBe(409);
    expect(body).toMatchObject({ code: 'QUOTA_EXCEEDED' });
    expect(body).not.toHaveProperty('currentUsage');
    expect(body).not.toHaveProperty('max');
  });

  it('uses server-selected Feature/resource and server-provided usage, ignoring client choices', async () => {
    const response = await app.inject({
      method: 'POST',
      url: route,
      headers: validHeaders,
      payload: {
        tenantId: otherTenantId,
        featureKey: 'CLIENT_FEATURE',
        resourceKey: 'CLIENT_RESOURCE',
        currentUsage: 0,
        planId: 'client-plan',
        subscriptionId: 'client-subscription',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ outcome: 'AVAILABLE' });
    expect(entitlements.resolve).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ tenantId }),
      'APPOINTMENTS',
    );
    expect(quotas.findActivePlanFeatureQuotaLimits).toHaveBeenCalledExactlyOnceWith(
      currentPlanId,
      currentFeatureId,
    );
  });

  it('does not let a platform role replace tenant permission when all three decisions would fail', async () => {
    authorization.authorize.mockRejectedValueOnce(new TenantPermissionDeniedError());
    entitlements.resolve.mockResolvedValueOnce({
      outcome: 'NOT_ENTITLED',
      entitled: false,
      reason: 'NOT_ENTITLED_PLAN_FEATURE',
      featureKey: 'APPOINTMENTS',
    });
    quotas.findActivePlanFeatureQuotaLimits.mockResolvedValueOnce({ kind: 'unavailable' });

    const response = await app.inject({ method: 'POST', url: route, headers: validHeaders });

    expect(response.statusCode).toBe(403);
    expect(entitlements.resolve).not.toHaveBeenCalled();
    expect(quotas.findActivePlanFeatureQuotaLimits).not.toHaveBeenCalled();
  });
});
