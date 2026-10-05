import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { TrustedTenantContext } from './tenant-context.contract';

export const CurrentTenantContext = createParamDecorator(
  (_data: unknown, context: ExecutionContext): TrustedTenantContext | undefined =>
    context.switchToHttp().getRequest<FastifyRequest>().trustedTenantContext,
);
