import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { AuthenticationError } from '../auth/errors/auth.errors';
import { TenantContextInvalidError, TenantContextRequiredError } from './tenant-context.contract';
import { TenantPermissionRequirementMissingError } from './tenant-authorization.errors';
import { TenantAuthorizationService } from './tenant-authorization.service';
import type { TenantPermissionCode } from './tenant-authorization.constants';
import { TENANT_REQUIRED_PERMISSIONS } from './tenant-require-permissions.decorator';

@Injectable()
export class TenantAuthorizationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorization: TenantAuthorizationService,
  ) {}

  async canActivate(executionContext: ExecutionContext): Promise<boolean> {
    const request = executionContext.switchToHttp().getRequest<FastifyRequest>();
    const authenticatedPlatformUser = request.authenticatedPlatformUser;
    if (!authenticatedPlatformUser) {
      throw new AuthenticationError('AUTH_TOKEN_MISSING', 'Authorization token is required');
    }
    if (typeof authenticatedPlatformUser.userId !== 'string') {
      throw new AuthenticationError('AUTH_TOKEN_INVALID', 'Authorization token is invalid');
    }

    const trustedTenantContext = request.trustedTenantContext;
    if (!trustedTenantContext) throw new TenantContextRequiredError();

    const routeTenantId = (request.params as Record<string, unknown> | undefined)?.tenantId;
    if (
      typeof trustedTenantContext.tenantId !== 'string' ||
      typeof trustedTenantContext.platformUserId !== 'string' ||
      typeof routeTenantId !== 'string' ||
      routeTenantId.toLowerCase() !== trustedTenantContext.tenantId.toLowerCase() ||
      authenticatedPlatformUser.userId.toLowerCase() !==
        trustedTenantContext.platformUserId.toLowerCase()
    ) {
      throw new TenantContextInvalidError();
    }

    const requiredPermissions = this.reflector.getAllAndOverride<TenantPermissionCode[]>(
      TENANT_REQUIRED_PERMISSIONS,
      [executionContext.getHandler(), executionContext.getClass()],
    );
    if (!requiredPermissions?.length) throw new TenantPermissionRequirementMissingError();

    for (const permissionCode of requiredPermissions) {
      await this.authorization.authorize(trustedTenantContext, permissionCode);
    }
    return true;
  }
}
