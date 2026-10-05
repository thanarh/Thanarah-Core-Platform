/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-function-return-type, @typescript-eslint/consistent-type-imports */
import { describe, expect, it, vi } from 'vitest';
import { AuthenticationService } from '../src/auth/services/authentication.service';
import { AuthController } from '../src/auth/auth.controller';
import { PlatformSessionService } from '../src/auth/services/platform-session.service';
import { PlatformUserRepository } from '../src/auth/repositories/platform-user.repository';
import {
  RefreshRotationFailedError,
  RefreshTokenExpiredError,
  RefreshTokenInvalidError,
} from '../src/auth/errors/auth.errors';
import { IS_PUBLIC_KEY } from '../src/auth/auth.constants';

const config = {
  maxFailedLoginAttempts: 3,
  loginLockMinutes: 15,
  refreshTokenTtlDays: 30,
} as any;

function record(overrides: any = {}) {
  return {
    id: 'u1',
    email: 'User@Example.com',
    passwordHash: 'hash',
    status: 'ACTIVE',
    tokenVersion: 2,
    failedLoginAttempts: 0,
    lockedUntil: null,
    ...overrides,
  };
}

function auth(overrides: any = {}) {
  const users = {
    findLoginRecordByEmail: vi.fn().mockResolvedValue(record()),
    recordFailedLogin: vi.fn(),
    resetFailedLogins: vi.fn(),
    findAuthRecordById: vi.fn().mockResolvedValue({ id: 'u1', status: 'ACTIVE', tokenVersion: 2 }),
    ...overrides.users,
  };
  const passwords = { verify: vi.fn().mockResolvedValue(true), ...overrides.passwords };
  const sessions = {
    create: vi.fn().mockResolvedValue({ id: 's1', userId: 'u1' }),
    ...overrides.sessions,
  };
  const refreshTokens = {
    issue: vi.fn().mockReturnValue({ token: 'opaque', hash: 'hash' }),
    rotate: vi.fn(),
    ...overrides.refreshTokens,
  };
  const access = { sign: vi.fn().mockResolvedValue('access'), ...overrides.access };
  const authorization = {
    getRoleIdsByUserId: vi.fn().mockResolvedValue(['role-id']),
    ...overrides.authorization,
  };
  return {
    service: new AuthenticationService(
      users as any,
      passwords as any,
      config,
      sessions as any,
      refreshTokens as any,
      access as any,
      { generateTokenFamilyId: () => 'family' } as any,
      authorization as any,
    ),
    users,
    passwords,
    sessions,
    refreshTokens,
    access,
  };
}

describe('AuthenticationService correction contract', () => {
  it('normalizes email and invokes dummy verification for unknown users', async () => {
    const a = auth({ users: { findLoginRecordByEmail: vi.fn().mockResolvedValue(null) } });
    await expect(
      a.service.login('  USER@Example.COM ', 'secret', { ipAddress: '1.2.3.4', userAgent: null }),
    ).rejects.toMatchObject({ response: { code: 'AUTH_INVALID_CREDENTIALS' } });
    expect(a.users.findLoginRecordByEmail).toHaveBeenCalledWith('user@example.com');
    expect(a.passwords.verify).toHaveBeenCalledOnce();
    expect(a.passwords.verify.mock.calls[0][0]).toMatch(/^\$argon2id\$/);
  });

  it('records invalid credentials and locks at the configured threshold', async () => {
    const a = auth({
      users: {
        findLoginRecordByEmail: vi.fn().mockResolvedValue(record({ failedLoginAttempts: 2 })),
      },
      passwords: { verify: vi.fn().mockResolvedValue(false) },
    });
    await expect(
      a.service.login('user@example.com', 'bad', { ipAddress: '::1', userAgent: 'ua' }),
    ).rejects.toBeTruthy();
    expect(a.users.recordFailedLogin).toHaveBeenCalledWith('u1', 3, 15);
  });

  it('rejects active locks, but permits expired locks and resets after success', async () => {
    const locked = auth({
      users: {
        findLoginRecordByEmail: vi
          .fn()
          .mockResolvedValue(record({ lockedUntil: new Date(Date.now() + 10000) })),
      },
    });
    await expect(
      locked.service.login('u1', 'ok', { ipAddress: 'x', userAgent: null }),
    ).rejects.toMatchObject({ response: { code: 'AUTH_ACCOUNT_LOCKED' } });
    const expired = auth({
      users: {
        findLoginRecordByEmail: vi.fn().mockResolvedValue(record({ lockedUntil: new Date(0) })),
      },
    });
    const result = await expired.service.login('u1', 'ok', { ipAddress: 'x', userAgent: 'ua' });
    expect(result).toEqual({ accessToken: 'access', refreshToken: 'opaque' });
    expect(expired.users.resetFailedLogins).toHaveBeenCalledWith('u1');
    const inactive = auth({
      users: { findLoginRecordByEmail: vi.fn().mockResolvedValue(record({ status: 'INACTIVE' })) },
    });
    await expect(
      inactive.service.login('u1', 'ok', { ipAddress: 'x', userAgent: null }),
    ).rejects.toMatchObject({ response: { code: 'AUTH_ACCOUNT_INACTIVE' } });
  });

  it('refreshes safely and classifies transient failures without cookie clearing', async () => {
    const a = auth({
      refreshTokens: {
        rotate: vi
          .fn()
          .mockResolvedValue({ refreshToken: 'next', session: { id: 's1', userId: 'u1' } }),
      },
    });
    await expect(a.service.refresh('old')).resolves.toEqual({
      accessToken: 'access',
      refreshToken: 'next',
    });
    expect(a.access.sign).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'u1', sessionId: 's1' }),
    );
    expect(AuthenticationService.isCredentialRefreshError(new RefreshTokenInvalidError())).toBe(
      true,
    );
    expect(AuthenticationService.isCredentialRefreshError(new RefreshTokenExpiredError())).toBe(
      true,
    );
    expect(AuthenticationService.isCredentialRefreshError(new RefreshRotationFailedError())).toBe(
      false,
    );
  });
});

describe('atomic failed-login repository update', () => {
  it('increments and applies threshold lock in one transaction', async () => {
    const tx = { user: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } };
    const prisma = { $transaction: vi.fn(async (fn: any) => fn(tx)) };
    await new PlatformUserRepository(prisma as any).recordFailedLogin('u1', 5, 15);
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(tx.user.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'u1' },
      data: { failedLoginAttempts: { increment: 1 } },
    });
    expect(tx.user.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'u1',
          failedLoginAttempts: { gte: 5 },
          OR: expect.any(Array),
        }),
        data: expect.objectContaining({ lockedUntil: expect.any(Date) }),
      }),
    );
  });
});

describe('AuthController public HTTP contract', () => {
  it('marks exact login and refresh handlers public with exact throttles', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, AuthController.prototype.login)).toBe(true);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, AuthController.prototype.refreshToken)).toBe(true);
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', AuthController.prototype.login)).toBe(10);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', AuthController.prototype.login)).toBe(60000);
    expect(
      Reflect.getMetadata('THROTTLER:LIMITdefault', AuthController.prototype.refreshToken),
    ).toBe(30);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', AuthController.prototype.refreshToken)).toBe(
      60000,
    );
    expect(Reflect.getMetadata('path', AuthController.prototype.login)).toBe('login');
    expect(Reflect.getMetadata('path', AuthController.prototype.refreshToken)).toBe('refresh');
  });

  it('returns access only, ignores hostile body fields, and sets HttpOnly refresh cookie', async () => {
    const authentication = {
      login: vi.fn().mockResolvedValue({ accessToken: 'access', refreshToken: 'opaque' }),
      refresh: vi.fn(),
    };
    const cookies = { setRefreshToken: vi.fn(), clearRefreshToken: vi.fn() };
    const controller = new AuthController(
      {} as PlatformSessionService,
      cookies as any,
      authentication as any,
    );
    const result = await controller.login(
      { email: 'a', password: 'b', role: 'OWNER', sessionId: 'attacker' } as any,
      { ip: '10.0.0.1', headers: { 'user-agent': 'ua' } } as any,
      {} as any,
    );
    expect(result).toEqual({ accessToken: 'access' });
    expect(authentication.login).toHaveBeenCalledWith('a', 'b', {
      ipAddress: '10.0.0.1',
      userAgent: 'ua',
    });
    expect(cookies.setRefreshToken).toHaveBeenCalledWith({}, 'opaque');
  });

  it('clears credential refresh failures but preserves cookies on transient rotation failures', async () => {
    const cookies = {
      readRefreshToken: vi.fn().mockReturnValue('opaque'),
      setRefreshToken: vi.fn(),
      clearRefreshToken: vi.fn(),
    };
    const authentication = {
      login: vi.fn(),
      refresh: vi.fn().mockRejectedValueOnce(new RefreshTokenInvalidError()),
    };
    const controller = new AuthController(
      {} as PlatformSessionService,
      cookies as any,
      authentication as any,
    );
    await expect(controller.refreshToken({ cookies: {} } as any, {} as any)).rejects.toBeInstanceOf(
      RefreshTokenInvalidError,
    );
    expect(cookies.clearRefreshToken).toHaveBeenCalledOnce();
    authentication.refresh.mockRejectedValueOnce(new RefreshRotationFailedError());
    await expect(controller.refreshToken({ cookies: {} } as any, {} as any)).rejects.toBeInstanceOf(
      RefreshRotationFailedError,
    );
    expect(cookies.clearRefreshToken).toHaveBeenCalledOnce();
  });

  it('rejects malformed login bodies before delegation', async () => {
    const authentication = { login: vi.fn(), refresh: vi.fn() };
    const controller = new AuthController(
      {} as PlatformSessionService,
      {} as any,
      authentication as any,
    );
    await expect(controller.login({ email: 'only' } as any, {} as any, {} as any)).rejects.toThrow(
      'Invalid login request',
    );
    expect(authentication.login).not.toHaveBeenCalled();
  });
});
