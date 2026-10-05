import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { TrustedTenantContext } from './tenant-context.contract';
import { TenantContextRequiredError } from './tenant-context.contract';
import {
  TenantMembershipValidatorService,
  TrustedTenantContextFactoryService,
} from './tenant-context.service';

declare module 'fastify' {
  interface FastifyRequest {
    trustedTenantContext?: TrustedTenantContext;
  }
}

@Injectable()
export class TenantContextGuard implements CanActivate {
  constructor(
    private readonly memberships: TenantMembershipValidatorService,
    private readonly contextFactory: TrustedTenantContextFactoryService,
  ) {}

  async canActivate(executionContext: ExecutionContext): Promise<boolean> {
    const request = executionContext.switchToHttp().getRequest<FastifyRequest>();
    const authenticatedPlatformUser = request.authenticatedPlatformUser;
    if (!authenticatedPlatformUser) throw new TenantContextRequiredError();

    const params = request.params;
    if (!params || typeof params !== 'object' || !('tenantId' in params)) {
      throw new TenantContextRequiredError();
    }
    const tenantIdCandidate = (params as Record<string, unknown>).tenantId;
    if (typeof tenantIdCandidate !== 'string' || !tenantIdCandidate.trim()) {
      throw new TenantContextRequiredError();
    }

    const membership = await this.memberships.validateMembership({
      authenticatedPlatformUser,
      tenantIdCandidate,
    });
    request.trustedTenantContext = this.contextFactory.fromValidatedMembership(membership);
    return true;
  }
}
