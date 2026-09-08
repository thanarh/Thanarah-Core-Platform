import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PlatformSessionStatus, UserStatus, type PlatformSession } from '@prisma/client';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AccessTokenService } from '../src/auth/services/access-token.service';
import { AuthCookieService } from '../src/auth/services/auth-cookie.service';
import { RefreshTokenService } from '../src/auth/services/refresh-token.service';
import { PlatformSessionService } from '../src/auth/services/platform-session.service';
import { PlatformAuthGuard } from '../src/auth/guards/platform-auth.guard';
import { PasswordHasherService } from '../src/auth/security/password-hasher.service';
import { PasswordPolicyService } from '../src/auth/security/password-policy.service';
import { TokenGeneratorService } from '../src/auth/security/token-generator.service';
import { TokenHasherService } from '../src/auth/security/token-hasher.service';
import type { ConfigService } from '../src/config/config.service';
import type { PlatformSessionRepository } from '../src/auth/repositories/platform-session.repository';
import type { PlatformUserRepository } from '../src/auth/repositories/platform-user.repository';
import { validateEnv } from '../src/config/env.schema';
import type { AuthenticationError } from '../src/auth/errors/auth.errors';
import {
  AccessTokenExpiredError,
  InvalidTokenAudienceError,
  InvalidTokenClaimsError,
  InvalidTokenIssuerError,
  InvalidTokenSignatureError,
  MalformedTokenError,
  MissingTokenSecretError,
  RefreshRotationFailedError,
  RefreshSessionCompromisedError,
  RefreshSessionRevokedError,
  RefreshTokenExpiredError,
  RefreshTokenInvalidError,
  RefreshTokenReusedError,
} from '../src/auth/errors/auth.errors';

const secret = 'a'.repeat(48);

function config(overrides: Partial<Record<string, unknown>> = {}): ConfigService {
  return {
    jwtAccessSecret: secret,
    accessTokenTtlMinutes: 15,
    refreshTokenTtlDays: 30,
    refreshCookieName: 'refresh',
    refreshCookieDomain: undefined,
    refreshCookieSecure: true,
    refreshCookieSameSite: 'strict',
    ...overrides,
  } as unknown as ConfigService;
}

function session(overrides: Partial<PlatformSession> = {}): PlatformSession {
  return {
    id: 'session',
    userId: 'user',
    refreshTokenHash: 'hash',
    tokenFamilyId: 'family',
    status: PlatformSessionStatus.ACTIVE,
    ipAddress: null,
    userAgent: null,
    deviceName: null,
    deviceType: null,
    browser: null,
    operatingSystem: null,
    countryCode: null,
    createdAt: new Date(),
    lastActivityAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    revokedBy: null,
    revocationReason: null,
    ...overrides,
  };
}

describe('AccessTokenService', () => {
  const claims = {
    sub: 'user',
    sessionId: 'session',
    tokenVersion: 2,
    platformRoleIds: ['role'],
  };

  it('signs and verifies only the intended claims with issuer and audience', async () => {
    const service = new AccessTokenService(new JwtService(), config());
    const token = await service.sign(claims);
    const decoded = await service.verify(token);
    expect(decoded).toMatchObject(claims);
    expect(decoded).not.toHaveProperty('email');
    const raw = new JwtService().decode(token) as Record<string, unknown>;
    expect(raw).toMatchObject({ iss: 'thanarah', aud: 'thanarah-platform' });
    expect(raw).not.toHaveProperty('permissions');
  });

  it('rejects expired tokens', async () => {
    const jwt = new JwtService();
    const token = await jwt.signAsync(claims, {
      secret,
      issuer: 'thanarah',
      audience: 'thanarah-platform',
      expiresIn: -1,
    });
    await expect(new AccessTokenService(jwt, config()).verify(token)).rejects.toBeInstanceOf(
      AccessTokenExpiredError,
    );
  });

  it('distinguishes issuer, audience, malformed and missing secret failures', async () => {
    const jwt = new JwtService();
    const service = new AccessTokenService(jwt, config());
    const wrongIssuer = await jwt.signAsync(claims, {
      secret,
      issuer: 'other',
      audience: 'thanarah-platform',
    });
    const wrongAudience = await jwt.signAsync(claims, {
      secret,
      issuer: 'thanarah',
      audience: 'other',
    });
    await expect(service.verify(wrongIssuer)).rejects.toBeInstanceOf(InvalidTokenIssuerError);
    await expect(service.verify(wrongAudience)).rejects.toBeInstanceOf(InvalidTokenAudienceError);
    await expect(service.verify('not-a-jwt')).rejects.toBeInstanceOf(MalformedTokenError);
    await expect(
      new AccessTokenService(jwt, config({ jwtAccessSecret: '' })).sign(claims),
    ).rejects.toBeInstanceOf(MissingTokenSecretError);
  });

  it('rejects invalid signatures and required claim violations', async () => {
    const jwt = new JwtService();
    const service = new AccessTokenService(jwt, config());
    const wrongSignature = await jwt.signAsync(claims, {
      secret: 'b'.repeat(48),
      issuer: 'thanarah',
      audience: 'thanarah-platform',
      algorithm: 'HS256',
    });
    const invalidClaims = await jwt.signAsync(
      { sub: 'user', sessionId: '', tokenVersion: -1, platformRoleIds: [''] },
      {
        secret,
        issuer: 'thanarah',
        audience: 'thanarah-platform',
        algorithm: 'HS256',
      },
    );

    await expect(service.verify(wrongSignature)).rejects.toBeInstanceOf(InvalidTokenSignatureError);
    await expect(service.verify(invalidClaims)).rejects.toBeInstanceOf(InvalidTokenClaimsError);
  });
});

describe('token security', () => {
  it('generates 384-bit opaque base64url tokens and stable SHA-256 hashes', () => {
    const token = new TokenGeneratorService().generateRefreshToken();
    expect(Buffer.from(token, 'base64url')).toHaveLength(48);
    expect(token).toMatch(/^[A-Za-z0-9_-]{64}$/);
    const hasher = new TokenHasherService();
    expect(hasher.hash(token)).toHaveLength(64);
    expect(hasher.matches(token, hasher.hash(token))).toBe(true);
    expect(hasher.matches(`${token}x`, hasher.hash(token))).toBe(false);
  });

  it('hashes and verifies passwords with Argon2id and enforces password policy', async () => {
    const policy = new PasswordPolicyService();
    expect(() => policy.validate('short')).toThrow(BadRequestException);
    expect(() => policy.validate('StrongEnough1!')).not.toThrow();

    const passwords = new PasswordHasherService();
    const hash = await passwords.hash('StrongEnough1!');
    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(passwords.verify(hash, 'StrongEnough1!')).resolves.toBe(true);
    await expect(passwords.verify(hash, 'WrongPassword1!')).resolves.toBe(false);
  });
});

describe('RefreshTokenService', () => {
  it('rotates current token while preserving session identity', async () => {
    const hasher = new TokenHasherService();
    const old = 'old-token';
    const existing = session({ refreshTokenHash: hasher.hash(old) });
    const repository = {
      rotateByRefreshTokenHash: vi
        .fn()
        .mockImplementation((_session: PlatformSession, hash: string) =>
          Promise.resolve({
            kind: 'rotated',
            session: session({ ...existing, refreshTokenHash: hash }),
          }),
        ),
    } as unknown as PlatformSessionRepository;
    const service = new RefreshTokenService(repository, new TokenGeneratorService(), hasher);
    const result = await service.rotate(old);
    expect(result.session.id).toBe(existing.id);
    expect(result.session.tokenFamilyId).toBe(existing.tokenFamilyId);
    expect(repository.rotateByRefreshTokenHash).toHaveBeenCalledOnce();
  });

  it('detects history reuse and compromises the session atomically', async () => {
    const repository = {
      rotateByRefreshTokenHash: vi.fn().mockResolvedValue({ kind: 'reused' }),
    } as unknown as PlatformSessionRepository;
    const service = new RefreshTokenService(
      repository,
      new TokenGeneratorService(),
      new TokenHasherService(),
    );
    await expect(service.rotate('reused')).rejects.toBeInstanceOf(RefreshTokenReusedError);
    expect(repository.rotateByRefreshTokenHash).toHaveBeenCalledOnce();
  });

  it('rejects unknown refresh tokens', async () => {
    const repository = {
      rotateByRefreshTokenHash: vi.fn().mockResolvedValue({ kind: 'not-found' }),
    } as unknown as PlatformSessionRepository;
    const service = new RefreshTokenService(
      repository,
      new TokenGeneratorService(),
      new TokenHasherService(),
    );
    await expect(service.rotate('unknown')).rejects.toBeInstanceOf(RefreshTokenInvalidError);
  });

  it.each([
    ['revoked', RefreshSessionRevokedError],
    ['compromised', RefreshSessionCompromisedError],
    ['expired', RefreshTokenExpiredError],
    ['reused', RefreshTokenReusedError],
  ] as const)('maps the %s repository result to its stable error', async (kind, errorType) => {
    const repository = {
      rotateByRefreshTokenHash: vi.fn().mockResolvedValue({ kind }),
    } as unknown as PlatformSessionRepository;
    const service = new RefreshTokenService(
      repository,
      new TokenGeneratorService(),
      new TokenHasherService(),
    );

    await expect(service.rotate('presented')).rejects.toBeInstanceOf(errorType);
  });

  it('maps transaction failures without exposing their details', async () => {
    const repository = {
      rotateByRefreshTokenHash: vi.fn().mockRejectedValue(new Error('database detail')),
    } as unknown as PlatformSessionRepository;
    const service = new RefreshTokenService(
      repository,
      new TokenGeneratorService(),
      new TokenHasherService(),
    );

    await expect(service.rotate('presented')).rejects.toBeInstanceOf(RefreshRotationFailedError);
    await expect(service.rotate('')).rejects.toBeInstanceOf(RefreshTokenInvalidError);
  });
});

describe('AuthCookieService', () => {
  it('sets, reads and clears an HttpOnly configured refresh cookie', () => {
    const service = new AuthCookieService(config());
    const reply = { setCookie: vi.fn(), clearCookie: vi.fn() } as unknown as FastifyReply;
    service.setRefreshToken(reply, 'opaque');
    expect(reply.setCookie).toHaveBeenCalledWith(
      'refresh',
      'opaque',
      expect.objectContaining({ httpOnly: true, secure: true, sameSite: 'strict' }),
    );
    expect(
      service.readRefreshToken({ cookies: { refresh: 'opaque' } } as unknown as FastifyRequest),
    ).toBe('opaque');
    service.clearRefreshToken(reply);
    expect(reply.clearCookie).toHaveBeenCalledWith('refresh', {
      domain: undefined,
      httpOnly: true,
      path: '/',
      sameSite: 'strict',
      secure: true,
    });
  });
});

describe('authentication configuration', () => {
  it('uses safe development defaults without requiring a database or signing secret', () => {
    expect(validateEnv({})).toMatchObject({
      NODE_ENV: 'development',
      DATABASE_URL: '',
      JWT_ACCESS_SECRET: '',
      AUTH_ACCESS_TOKEN_TTL_MINUTES: 15,
      AUTH_REFRESH_TOKEN_TTL_DAYS: 30,
      AUTH_REFRESH_COOKIE_SECURE: false,
      AUTH_REFRESH_COOKIE_SAME_SITE: 'strict',
    });
  });

  it('requires a strong secret and secure refresh cookies in production', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'short',
        AUTH_REFRESH_COOKIE_SECURE: 'false',
      }),
    ).toThrow(/JWT_ACCESS_SECRET.*AUTH_REFRESH_COOKIE_SECURE/s);

    expect(
      validateEnv({
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'a'.repeat(48),
        AUTH_REFRESH_COOKIE_SECURE: 'true',
      }),
    ).toMatchObject({ AUTH_REFRESH_COOKIE_SECURE: true });
  });

  it('requires Secure whenever SameSite=None is configured', () => {
    expect(() =>
      validateEnv({
        AUTH_REFRESH_COOKIE_SAME_SITE: 'none',
        AUTH_REFRESH_COOKIE_SECURE: 'false',
      }),
    ).toThrow(/Secure cookies are required with SameSite=None/);
  });
});

describe('PlatformSessionService', () => {
  it('delegates current and all-session revocation without changing the supplied scope', async () => {
    const repository = {
      revokeOne: vi.fn().mockResolvedValue(session({ status: PlatformSessionStatus.REVOKED })),
      revokeAll: vi.fn().mockResolvedValue(2),
    } as unknown as PlatformSessionRepository;
    const service = new PlatformSessionService(repository);

    await service.revokeOne('session', 'user', 'USER_LOGOUT');
    await service.revokeAll('user', 'user', 'USER_LOGOUT_ALL');

    expect(repository.revokeOne).toHaveBeenCalledWith('session', 'user', 'USER_LOGOUT');
    expect(repository.revokeAll).toHaveBeenCalledWith('user', 'user', 'USER_LOGOUT_ALL');
  });
});

describe('PlatformAuthGuard', () => {
  function context(request: object): ExecutionContext {
    return {
      getHandler: () => function handler() {},
      getClass: () => class Test {},
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  function guard(
    requestPublic: boolean,
    user: object | null = { id: 'user', status: UserStatus.ACTIVE, tokenVersion: 1 },
    currentSession: PlatformSession | null = session(),
  ): PlatformAuthGuard {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue(requestPublic),
    } as unknown as Reflector;
    const access = {
      verify: vi.fn().mockResolvedValue({
        sub: 'user',
        sessionId: 'session',
        tokenVersion: 1,
        platformRoleIds: ['role'],
      }),
    } as unknown as AccessTokenService;
    const users = {
      findAuthRecordById: vi.fn().mockResolvedValue(user),
    } as unknown as PlatformUserRepository;
    const sessions = {
      findById: vi.fn().mockResolvedValue(currentSession),
    } as unknown as PlatformSessionRepository;
    return new PlatformAuthGuard(reflector, access, users, sessions);
  }

  it('bypasses public routes and rejects a missing header', async () => {
    await expect(guard(true).canActivate(context({ headers: {} }))).resolves.toBe(true);
    await expect(guard(false).canActivate(context({ headers: {} }))).rejects.toMatchObject({
      response: { code: 'AUTH_TOKEN_MISSING' },
    });
  });

  it.each(['Basic token', 'Bearer', 'Bearer   ', 'bearer token'])(
    'rejects malformed authorization header %s',
    async (authorization) => {
      await expect(
        guard(false).canActivate(context({ headers: { authorization } })),
      ).rejects.toMatchObject({
        response: { code: 'AUTH_TOKEN_MALFORMED' },
      });
    },
  );

  it('attaches only safe context after all checks', async () => {
    const request = { headers: { authorization: 'Bearer token' } };
    await expect(guard(false).canActivate(context(request))).resolves.toBe(true);
    expect(request).toMatchObject({
      authenticatedPlatformUser: {
        userId: 'user',
        sessionId: 'session',
        tokenVersion: 1,
        platformRoleIds: ['role'],
      },
    });
  });

  it.each([
    [null, session(), 'AUTH_USER_NOT_FOUND'],
    [
      { id: 'user', status: UserStatus.INACTIVE, tokenVersion: 1 },
      session(),
      'AUTH_ACCOUNT_INACTIVE',
    ],
    [
      { id: 'user', status: UserStatus.ACTIVE, tokenVersion: 2 },
      session(),
      'AUTH_TOKEN_VERSION_MISMATCH',
    ],
    [{ id: 'user', status: UserStatus.ACTIVE, tokenVersion: 1 }, null, 'AUTH_SESSION_NOT_FOUND'],
    [
      { id: 'user', status: UserStatus.ACTIVE, tokenVersion: 1 },
      session({ userId: 'other' }),
      'AUTH_SESSION_USER_MISMATCH',
    ],
    [
      { id: 'user', status: UserStatus.ACTIVE, tokenVersion: 1 },
      session({ status: PlatformSessionStatus.REVOKED }),
      'AUTH_SESSION_REVOKED',
    ],
    [
      { id: 'user', status: UserStatus.ACTIVE, tokenVersion: 1 },
      session({ status: PlatformSessionStatus.COMPROMISED }),
      'AUTH_SESSION_COMPROMISED',
    ],
    [
      { id: 'user', status: UserStatus.ACTIVE, tokenVersion: 1 },
      session({ status: PlatformSessionStatus.EXPIRED }),
      'AUTH_SESSION_EXPIRED',
    ],
    [
      { id: 'user', status: UserStatus.ACTIVE, tokenVersion: 1 },
      session({ expiresAt: new Date(0) }),
      'AUTH_SESSION_EXPIRED',
    ],
  ])('enforces user and session state', async (user, currentSession, code) => {
    const action = guard(false, user, currentSession).canActivate(
      context({ headers: { authorization: 'Bearer token' } }),
    );
    await expect(action).rejects.toSatisfy(
      (error: AuthenticationError) => (error.getResponse() as { code: string }).code === code,
    );
  });
});
