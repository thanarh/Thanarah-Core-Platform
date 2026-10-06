import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedPlatformUser } from '../src/auth/auth.types';
import {
  TenantContextInvalidError,
  TenantContextRequiredError,
  type TrustedTenantContext,
} from '../src/tenant/tenant-context.contract';
import { TenantEntitlementGuard } from '../src/tenant/tenant-entitlement.guard';
import {
  TenantFeatureNotIncludedError,
  TenantFeatureRequirementMissingError,
} from '../src/tenant/tenant-entitlement.errors';
import type { TenantEntitlementService } from '../src/tenant/tenant-entitlement.service';
import {
  isTenantFeatureKey,
  RequireTenantFeature,
  TENANT_REQUIRED_FEATURE,
} from '../src/tenant/tenant-require-feature.decorator';

const tenantId = '11111111-1111-4111-8111-111111111111';
const membershipId = '22222222-2222-4222-8222-222222222222';
const platformUserId = '33333333-3333-4333-8333-333333333333';
const context = { tenantId, membershipId, platformUserId } as unknown as TrustedTenantContext;
const user: AuthenticatedPlatformUser = {
  userId: platformUserId,
  sessionId: '44444444-4444-4444-8444-444444444444',
  tokenVersion: 1,
  platformRoleIds: [],
};

interface EntitlementGuardRequest {
  authenticatedPlatformUser?: AuthenticatedPlatformUser;
  trustedTenantContext?: TrustedTenantContext;
  params?: Record<string, unknown>;
  body?: unknown;
  query?: Record<string, unknown>;
  headers?: Record<string, string>;
}

describe('TenantEntitlementGuard', () => {
  const reflector = { getAllAndOverride: vi.fn() };
  const entitlements = { requireFeature: vi.fn() };
  const request: EntitlementGuardRequest = {
    authenticatedPlatformUser: user,
    trustedTenantContext: context,
    params: { tenantId },
    body: { featureKey: 'CLIENT_FEATURE', planId: 'CLIENT_PLAN' },
    query: { featureKey: 'CLIENT_QUERY_FEATURE', planId: 'CLIENT_QUERY_PLAN' },
    headers: { 'x-feature-key': 'CLIENT_HEADER_FEATURE' },
  };
  let guard: TenantEntitlementGuard;

  function executionContext(): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => request as unknown as FastifyRequest }),
      getHandler: () => 'handler',
      getClass: () => 'controller',
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    request.authenticatedPlatformUser = user;
    request.trustedTenantContext = context;
    request.params = { tenantId };
    request.body = { featureKey: 'CLIENT_FEATURE', planId: 'CLIENT_PLAN' };
    request.query = { featureKey: 'CLIENT_QUERY_FEATURE', planId: 'CLIENT_QUERY_PLAN' };
    request.headers = { 'x-feature-key': 'CLIENT_HEADER_FEATURE' };
    reflector.getAllAndOverride.mockReturnValue('APPOINTMENTS');
    entitlements.requireFeature.mockResolvedValue(undefined);
    guard = new TenantEntitlementGuard(
      reflector as unknown as Reflector,
      entitlements as unknown as TenantEntitlementService,
    );
  });

  it('requires authenticated platform context', async () => {
    request.authenticatedPlatformUser = undefined;

    await expect(guard.canActivate(executionContext())).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'AUTH_TOKEN_MISSING' }),
    });
    expect(entitlements.requireFeature).not.toHaveBeenCalled();
  });

  it('fails closed when trusted tenant context is missing, even if request input supplies tenantId', async () => {
    request.trustedTenantContext = undefined;
    request.body = { tenantId };
    request.query = { tenantId };

    await expect(guard.canActivate(executionContext())).rejects.toBeInstanceOf(
      TenantContextRequiredError,
    );
    expect(entitlements.requireFeature).not.toHaveBeenCalled();
  });

  it('rejects malformed trusted tenant context', async () => {
    request.trustedTenantContext = {
      tenantId: 'not-a-tenant',
      membershipId,
      platformUserId,
    } as unknown as TrustedTenantContext;

    await expect(guard.canActivate(executionContext())).rejects.toBeInstanceOf(
      TenantContextInvalidError,
    );
    expect(entitlements.requireFeature).not.toHaveBeenCalled();
  });

  it('rejects a route tenant that differs from trusted context', async () => {
    request.params = { tenantId: '99999999-9999-4999-8999-999999999999' };

    await expect(guard.canActivate(executionContext())).rejects.toBeInstanceOf(
      TenantContextInvalidError,
    );
    expect(entitlements.requireFeature).not.toHaveBeenCalled();
  });

  it('rejects an authenticated actor that differs from trusted context', async () => {
    request.authenticatedPlatformUser = { ...user, userId: '99999999-9999-4999-8999-999999999999' };

    await expect(guard.canActivate(executionContext())).rejects.toBeInstanceOf(
      TenantContextInvalidError,
    );
    expect(entitlements.requireFeature).not.toHaveBeenCalled();
  });

  it('requires server-defined feature metadata', async () => {
    reflector.getAllAndOverride.mockReturnValueOnce(undefined);

    await expect(guard.canActivate(executionContext())).rejects.toBeInstanceOf(
      TenantFeatureRequirementMissingError,
    );
    expect(entitlements.requireFeature).not.toHaveBeenCalled();
  });

  it('requires only the static feature from route metadata, ignoring client feature and plan values', async () => {
    await expect(guard.canActivate(executionContext())).resolves.toBe(true);

    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(TENANT_REQUIRED_FEATURE, [
      'handler',
      'controller',
    ]);
    expect(entitlements.requireFeature).toHaveBeenCalledExactlyOnceWith(context, 'APPOINTMENTS');
  });

  it('returns the stable generic forbidden error for a denied entitlement', async () => {
    entitlements.requireFeature.mockRejectedValueOnce(new TenantFeatureNotIncludedError());

    await expect(guard.canActivate(executionContext())).rejects.toBeInstanceOf(
      TenantFeatureNotIncludedError,
    );
  });

  it('rejects invalid metadata rather than resolving a client-selected feature', async () => {
    reflector.getAllAndOverride.mockReturnValueOnce('client_feature');

    await expect(guard.canActivate(executionContext())).rejects.toBeInstanceOf(
      TenantFeatureRequirementMissingError,
    );
    expect(entitlements.requireFeature).not.toHaveBeenCalled();
  });

  it('accepts only uppercase catalog keys in the decorator', () => {
    expect(isTenantFeatureKey('APPOINTMENTS')).toBe(true);
    expect(isTenantFeatureKey('A'.repeat(65))).toBe(false);
    expect(() => RequireTenantFeature('appointments')).toThrow(TypeError);
  });

  it('does not interpret platform permissions as a feature requirement', async () => {
    reflector.getAllAndOverride.mockReturnValueOnce(undefined);

    await expect(guard.canActivate(executionContext())).rejects.toBeInstanceOf(
      TenantFeatureRequirementMissingError,
    );
    expect(entitlements.requireFeature).not.toHaveBeenCalled();
  });
});
