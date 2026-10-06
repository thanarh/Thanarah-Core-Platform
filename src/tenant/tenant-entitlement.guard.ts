import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { AuthenticationError } from '../auth/errors/auth.errors';
import {
  TenantContextInvalidError,
  TenantContextRequiredError,
  isWellFormedTrustedTenantContext,
} from './tenant-context.contract';
import { TenantEntitlementService } from './tenant-entitlement.service';
import { isTenantFeatureKey, TENANT_REQUIRED_FEATURE } from './tenant-require-feature.decorator';
import { TenantFeatureRequirementMissingError } from './tenant-entitlement.errors';

@Injectable()
export class TenantEntitlementGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlements: TenantEntitlementService,
  ) {}

  async canActivate(executionContext: ExecutionContext): Promise<boolean> {
    const request = executionContext.switchToHttp().getRequest<FastifyRequest>();
    const authenticatedPlatformUser = request.authenticatedPlatformUser;
    if (!authenticatedPlatformUser) {
      throw new AuthenticationError('AUTH_TOKEN_MISSING', 'Authorization token is required');
    }
    if (
      typeof authenticatedPlatformUser.userId !== 'string' ||
      !authenticatedPlatformUser.userId.trim()
    ) {
      throw new AuthenticationError('AUTH_TOKEN_INVALID', 'Authorization token is invalid');
    }

    const trustedTenantContext = request.trustedTenantContext;
    if (!trustedTenantContext) throw new TenantContextRequiredError();
    if (!isWellFormedTrustedTenantContext(trustedTenantContext)) {
      throw new TenantContextInvalidError();
    }

    const routeTenantId = (request.params as Record<string, unknown> | undefined)?.tenantId;
    if (
      typeof routeTenantId !== 'string' ||
      routeTenantId.toLowerCase() !== trustedTenantContext.tenantId.toLowerCase() ||
      authenticatedPlatformUser.userId.toLowerCase() !==
        trustedTenantContext.platformUserId.toLowerCase()
    ) {
      throw new TenantContextInvalidError();
    }

    const featureKey = this.reflector.getAllAndOverride<string>(TENANT_REQUIRED_FEATURE, [
      executionContext.getHandler(),
      executionContext.getClass(),
    ]);
    if (!isTenantFeatureKey(featureKey)) {
      throw new TenantFeatureRequirementMissingError();
    }

    await this.entitlements.requireFeature(trustedTenantContext, featureKey);
    return true;
  }
}
