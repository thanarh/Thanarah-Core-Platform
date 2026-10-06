import type { FastifyRequest } from 'fastify';
import { APP_CONSTANTS } from '../common/constants/app.constants';
import type { TrustedSecurityContext } from '../platform-security/platform-security.types';

export type SubscriptionAuditContext = Pick<
  TrustedSecurityContext,
  'requestId' | 'ipAddress' | 'userAgent'
>;

export function subscriptionAuditContext(request: FastifyRequest): SubscriptionAuditContext {
  const requestId = request.headers[APP_CONSTANTS.headers.requestId];
  const userAgent = request.headers['user-agent'];
  return {
    requestId: typeof requestId === 'string' ? requestId : undefined,
    ipAddress: request.ip,
    userAgent: typeof userAgent === 'string' ? userAgent : undefined,
  };
}
