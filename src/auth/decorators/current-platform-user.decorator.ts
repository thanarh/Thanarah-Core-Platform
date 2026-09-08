import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { AuthenticatedPlatformUser } from '../auth.types';

export const CurrentPlatformUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedPlatformUser | undefined =>
    context.switchToHttp().getRequest<FastifyRequest>().authenticatedPlatformUser,
);
