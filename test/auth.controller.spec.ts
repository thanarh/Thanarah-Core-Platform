import type { FastifyReply } from 'fastify';
import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { AuthController } from '../src/auth/auth.controller';
import { AUTH_REVOCATION_REASONS, IS_PUBLIC_KEY } from '../src/auth/auth.constants';
import type { AuthenticatedPlatformUser } from '../src/auth/auth.types';
import { PlatformAuthGuard } from '../src/auth/guards/platform-auth.guard';
import type { AuthCookieService } from '../src/auth/services/auth-cookie.service';
import type { PlatformSessionService } from '../src/auth/services/platform-session.service';

const trustedUser: AuthenticatedPlatformUser = {
  userId: 'trusted-user',
  sessionId: 'trusted-session',
  tokenVersion: 7,
  platformRoleIds: ['role'],
};

function harness(): {
  controller: AuthController;
  sessions: {
    revokeOne: ReturnType<typeof vi.fn>;
    revokeAll: ReturnType<typeof vi.fn>;
  };
  cookies: { clearRefreshToken: ReturnType<typeof vi.fn> };
  reply: FastifyReply;
} {
  const sessions = {
    revokeOne: vi.fn().mockResolvedValue(null),
    revokeAll: vi.fn().mockResolvedValue(0),
  };
  const cookies = { clearRefreshToken: vi.fn() };
  const reply = {} as FastifyReply;
  return {
    controller: new AuthController(
      sessions as unknown as PlatformSessionService,
      cookies as unknown as AuthCookieService,
    ),
    sessions,
    cookies,
    reply,
  };
}

describe('AuthController logout', () => {
  it('revokes only the trusted current session, clears the cookie and returns no payload', async () => {
    const test = harness();

    await expect(test.controller.logout(trustedUser, test.reply)).resolves.toBeUndefined();

    expect(test.sessions.revokeOne).toHaveBeenCalledOnce();
    expect(test.sessions.revokeOne).toHaveBeenCalledWith(
      'trusted-session',
      'trusted-user',
      AUTH_REVOCATION_REASONS.USER_LOGOUT,
    );
    expect(test.sessions.revokeAll).not.toHaveBeenCalled();
    expect(test.cookies.clearRefreshToken).toHaveBeenCalledOnce();
    expect(test.cookies.clearRefreshToken).toHaveBeenCalledWith(test.reply);
  });

  it('has no client input capable of overriding trusted session or user scope', async () => {
    const test = harness();
    const invokeWithUntrustedBody = test.controller.logout.bind(test.controller) as (
      user: AuthenticatedPlatformUser,
      reply: FastifyReply,
      body: { sessionId: string; userId: string },
    ) => Promise<void>;

    await invokeWithUntrustedBody(trustedUser, test.reply, {
      sessionId: 'attacker-session',
      userId: 'attacker-user',
    });

    expect(test.sessions.revokeOne).toHaveBeenCalledWith(
      'trusted-session',
      'trusted-user',
      AUTH_REVOCATION_REASONS.USER_LOGOUT,
    );
  });
});

describe('AuthController logout-all', () => {
  it('revokes all sessions in only the trusted user scope, clears cookie and returns no payload', async () => {
    const test = harness();

    await expect(test.controller.logoutAll(trustedUser, test.reply)).resolves.toBeUndefined();

    expect(test.sessions.revokeAll).toHaveBeenCalledOnce();
    expect(test.sessions.revokeAll).toHaveBeenCalledWith(
      'trusted-user',
      'trusted-user',
      AUTH_REVOCATION_REASONS.USER_LOGOUT_ALL,
    );
    expect(test.sessions.revokeOne).not.toHaveBeenCalled();
    expect(test.cookies.clearRefreshToken).toHaveBeenCalledWith(test.reply);
  });

  it('has no client input capable of overriding trusted user scope', async () => {
    const test = harness();
    const invokeWithUntrustedBody = test.controller.logoutAll.bind(test.controller) as (
      user: AuthenticatedPlatformUser,
      reply: FastifyReply,
      body: { userId: string },
    ) => Promise<void>;

    await invokeWithUntrustedBody(trustedUser, test.reply, { userId: 'attacker-user' });

    expect(test.sessions.revokeAll).toHaveBeenCalledWith(
      'trusted-user',
      'trusted-user',
      AUTH_REVOCATION_REASONS.USER_LOGOUT_ALL,
    );
  });
});

describe('AuthController route protection', () => {
  it.each(['logout', 'logoutAll'] as const)(
    'protects %s specifically with PlatformAuthGuard and exposes only a 204',
    (endpoint) => {
      const handler = AuthController.prototype[endpoint];
      const guards = Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[] | undefined;
      expect(guards).toContain(PlatformAuthGuard);
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBeUndefined();
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(204);
    },
  );
});
