import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { REQUIRED_PERMISSIONS_KEY } from '../auth.constants';
import { AuthorizationForbiddenError } from '../errors/authorization.errors';
import type { PlatformPermissionCode } from '../platform-authorization.constants';
import { PlatformAuthorizationService } from '../services/platform-authorization.service';

@Injectable()
export class PlatformAuthorizationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorization: PlatformAuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<PlatformPermissionCode[]>(
      REQUIRED_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredPermissions?.length) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    // PlatformAuthGuard must run first for protected routes; authorization never authenticates.
    const userId = request.authenticatedPlatformUser?.userId;
    if (!userId) throw new AuthorizationForbiddenError();

    if (!(await this.authorization.hasPermissions(userId, requiredPermissions))) {
      throw new AuthorizationForbiddenError();
    }
    return true;
  }
}
