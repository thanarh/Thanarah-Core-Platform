import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { IS_PUBLIC_KEY } from '../auth.constants';
import { AuthenticationError } from '../errors/auth.errors';
import { AccessTokenService } from '../services/access-token.service';
import {
  PLATFORM_SESSION_PERSISTENCE,
  PLATFORM_USER_PERSISTENCE,
  type PlatformSessionPersistencePort,
  type PlatformUserPersistencePort,
} from '../../persistence/platform-persistence.ports';

@Injectable()
export class PlatformAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly accessTokens: AccessTokenService,
    @Inject(PLATFORM_USER_PERSISTENCE)
    private readonly users: PlatformUserPersistencePort,
    @Inject(PLATFORM_SESSION_PERSISTENCE)
    private readonly sessions: PlatformSessionPersistencePort,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const token = this.extractBearerToken(request.headers.authorization);
    const claims = await this.accessTokens.verify(token);
    const user = await this.users.findAuthRecordById(claims.sub);

    if (!user) throw new AuthenticationError('AUTH_USER_NOT_FOUND', 'User was not found');
    if (user.status !== 'ACTIVE') {
      throw new AuthenticationError('AUTH_ACCOUNT_INACTIVE', 'Account is not active');
    }
    if (user.tokenVersion !== claims.tokenVersion) {
      throw new AuthenticationError('AUTH_TOKEN_VERSION_MISMATCH', 'Token version is invalid');
    }

    const session = await this.sessions.findById(claims.sessionId);
    if (!session) throw new AuthenticationError('AUTH_SESSION_NOT_FOUND', 'Session was not found');
    if (session.userId !== user.id) {
      throw new AuthenticationError(
        'AUTH_SESSION_USER_MISMATCH',
        'Session does not belong to user',
      );
    }
    if (session.status === 'REVOKED') {
      throw new AuthenticationError('AUTH_SESSION_REVOKED', 'Session has been revoked');
    }
    if (session.status === 'COMPROMISED') {
      throw new AuthenticationError('AUTH_SESSION_COMPROMISED', 'Session is compromised');
    }
    if (session.status === 'EXPIRED' || session.expiresAt <= new Date()) {
      throw new AuthenticationError('AUTH_SESSION_EXPIRED', 'Session has expired');
    }

    request.authenticatedPlatformUser = {
      userId: user.id,
      sessionId: session.id,
      tokenVersion: user.tokenVersion,
      platformRoleIds: claims.platformRoleIds,
    };
    return true;
  }

  private extractBearerToken(authorization: string | undefined): string {
    if (!authorization) {
      throw new AuthenticationError('AUTH_TOKEN_MISSING', 'Authorization token is required');
    }
    const match = /^Bearer\s+(\S+)$/.exec(authorization);
    if (!match?.[1]) {
      throw new AuthenticationError('AUTH_TOKEN_MALFORMED', 'Authorization header is malformed');
    }
    return match[1];
  }
}
