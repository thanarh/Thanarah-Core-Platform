export interface AuthenticatedPlatformUser {
  userId: string;
  sessionId: string;
  tokenVersion: number;
  platformRoleIds: string[];
}

export interface AccessTokenClaims {
  sub: string;
  sessionId: string;
  tokenVersion: number;
  platformRoleIds: string[];
  iat?: number;
  exp?: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    authenticatedPlatformUser?: AuthenticatedPlatformUser;
  }
}
