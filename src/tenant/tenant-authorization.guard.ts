import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { TenantContextRequiredError } from './tenant-context.contract';
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
    const requiredPermissions = this.reflector.getAllAndOverride<TenantPermissionCode[]>(
      TENANT_REQUIRED_PERMISSIONS,
      [executionContext.getHandler(), executionContext.getClass()],
    );
    if (!requiredPermissions?.length) throw new TenantPermissionRequirementMissingError();

    const request = executionContext.switchToHttp().getRequest<FastifyRequest>();
    const trustedTenantContext = request.trustedTenantContext;
    if (!trustedTenantContext) throw new TenantContextRequiredError();

    for (const permissionCode of requiredPermissions) {
      await this.authorization.authorize(trustedTenantContext, permissionCode);
    }
    return true;
  }
}
