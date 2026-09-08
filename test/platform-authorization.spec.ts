import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { REQUIRED_PERMISSIONS_KEY } from '../src/auth/auth.constants';
import { RequirePermissions } from '../src/auth/decorators/require-permissions.decorator';
import { AuthorizationForbiddenError } from '../src/auth/errors/authorization.errors';
import { PlatformAuthorizationGuard } from '../src/auth/guards/platform-authorization.guard';
import type { PlatformPermissionCode } from '../src/auth/platform-authorization.constants';
import type { PlatformAuthorizationRepository } from '../src/auth/repositories/platform-authorization.repository';
import { PlatformAuthorizationService } from '../src/auth/services/platform-authorization.service';
import { PlatformRolePolicyService } from '../src/auth/services/platform-role-policy.service';

function context(request: object): ExecutionContext {
  return {
    getHandler: () => function handler() {},
    getClass: () => class Test {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function guard(
  requiredPermissions: PlatformPermissionCode[] | undefined,
  hasPermissions = true,
): {
  guard: PlatformAuthorizationGuard;
  authorization: { hasPermissions: ReturnType<typeof vi.fn> };
} {
  const reflector = {
    getAllAndOverride: vi.fn().mockReturnValue(requiredPermissions),
  } as unknown as Reflector;
  const authorization = { hasPermissions: vi.fn().mockResolvedValue(hasPermissions) };
  return {
    guard: new PlatformAuthorizationGuard(
      reflector,
      authorization as unknown as PlatformAuthorizationService,
    ),
    authorization,
  };
}

describe('RequirePermissions', () => {
  it('declares permission requirements without authorization logic', () => {
    class TestController {
      @RequirePermissions('platform_users.read', 'roles.read')
      handler(): void {}
    }

    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, TestController.prototype.handler)).toEqual(
      ['platform_users.read', 'roles.read'],
    );
  });
});

describe('PlatformAuthorizationGuard', () => {
  it('allows an authenticated user with every required server-side permission', async () => {
    const test = guard(['platform_users.read', 'roles.read']);
    const request = {
      authenticatedPlatformUser: {
        userId: 'trusted-user',
        sessionId: 'session',
        tokenVersion: 1,
        platformRoleIds: [],
      },
    };

    await expect(test.guard.canActivate(context(request))).resolves.toBe(true);
    expect(test.authorization.hasPermissions).toHaveBeenCalledWith('trusted-user', [
      'platform_users.read',
      'roles.read',
    ]);
  });

  it('rejects an authenticated user without a required permission with stable 403', async () => {
    const test = guard(['security_events.resolve'], false);

    await expect(
      test.guard.canActivate(
        context({
          authenticatedPlatformUser: {
            userId: 'trusted-user',
            sessionId: 'session',
            tokenVersion: 1,
            platformRoleIds: [],
          },
        }),
      ),
    ).rejects.toMatchObject({
      response: { code: 'AUTH_FORBIDDEN' },
      status: 403,
    });
  });

  it('permits routes with no authorization metadata without a database lookup', async () => {
    const test = guard(undefined);

    await expect(test.guard.canActivate(context({}))).resolves.toBe(true);
    expect(test.authorization.hasPermissions).not.toHaveBeenCalled();
  });

  it('does not trust client-injected permissions or role identifiers', async () => {
    const test = guard(['platform.manage'], false);
    const request = {
      body: { permissions: ['platform.manage'], roles: ['OWNER'] },
      headers: { 'x-permissions': 'platform.manage', 'x-roles': 'OWNER' },
      query: { permissions: ['platform.manage'], roles: ['OWNER'] },
      authenticatedPlatformUser: {
        userId: 'trusted-user',
        sessionId: 'session',
        tokenVersion: 1,
        platformRoleIds: ['attacker-controlled-role'],
      },
    };

    await expect(test.guard.canActivate(context(request))).rejects.toBeInstanceOf(
      AuthorizationForbiddenError,
    );
    expect(test.authorization.hasPermissions).toHaveBeenCalledWith('trusted-user', [
      'platform.manage',
    ]);
  });

  it('requires authentication to have established a trusted user context', async () => {
    const test = guard(['platform.read']);

    await expect(test.guard.canActivate(context({}))).rejects.toBeInstanceOf(
      AuthorizationForbiddenError,
    );
    expect(test.authorization.hasPermissions).not.toHaveBeenCalled();
  });
});

describe('PlatformAuthorizationService', () => {
  it('resolves permissions by authenticated user ID and requires all declared permissions', async () => {
    const repository = {
      findPermissionCodesByUserId: vi.fn().mockResolvedValue(['platform.read', 'roles.read']),
    } as unknown as PlatformAuthorizationRepository;
    const service = new PlatformAuthorizationService(repository);

    await expect(
      service.hasPermissions('trusted-user', ['platform.read', 'roles.read']),
    ).resolves.toBe(true);
    await expect(
      service.hasPermissions('trusted-user', ['platform.read', 'roles.assign']),
    ).resolves.toBe(false);
    expect(repository.findPermissionCodesByUserId).toHaveBeenCalledWith('trusted-user');
  });
});

describe('PlatformRolePolicyService', () => {
  it('requires roles.assign for every assignment and only OWNER for OWNER assignment', async () => {
    const ownerAuthorization = {
      getRoleCodes: vi.fn().mockResolvedValue(['OWNER']),
      hasPermissions: vi.fn().mockResolvedValue(true),
    } as unknown as PlatformAuthorizationService;
    const superAdminAuthorization = {
      getRoleCodes: vi.fn().mockResolvedValue(['SUPER_ADMIN']),
      hasPermissions: vi.fn().mockResolvedValue(true),
    } as unknown as PlatformAuthorizationService;
    const platformAdminAuthorization = {
      getRoleCodes: vi.fn().mockResolvedValue(['PLATFORM_ADMIN']),
      hasPermissions: vi.fn().mockResolvedValue(true),
    } as unknown as PlatformAuthorizationService;
    const supportAuthorization = {
      getRoleCodes: vi.fn().mockResolvedValue(['SUPPORT_ADMIN']),
      hasPermissions: vi.fn().mockResolvedValue(false),
    } as unknown as PlatformAuthorizationService;

    await expect(
      new PlatformRolePolicyService(ownerAuthorization).canAssignRole('owner-user', 'OWNER'),
    ).resolves.toBe(true);
    await expect(
      new PlatformRolePolicyService(superAdminAuthorization).canAssignRole('admin-user', 'OWNER'),
    ).resolves.toBe(false);
    await expect(
      new PlatformRolePolicyService(platformAdminAuthorization).canAssignRole(
        'platform-admin-user',
        'OWNER',
      ),
    ).resolves.toBe(false);
    await expect(
      new PlatformRolePolicyService(superAdminAuthorization).canAssignRole(
        'admin-user',
        'SUPPORT_ADMIN',
      ),
    ).resolves.toBe(true);
    await expect(
      new PlatformRolePolicyService(supportAuthorization).canAssignRole(
        'support-user',
        'SUPPORT_ADMIN',
      ),
    ).resolves.toBe(false);
  });
});

describe('platform authorization migration seed', () => {
  const migration = readFileSync(
    join(process.cwd(), 'prisma/migrations/20250602000000_platform_authorization/migration.sql'),
    'utf8',
  );
  const codes = (input: string): string[] =>
    [...input.matchAll(/'([^']+)'/g)].map((match) => match[1]);

  it('seeds exactly the expected platform permission and role codes', () => {
    const permissions = migration.match(
      /INSERT INTO `PlatformPermission`[\s\S]*?ON DUPLICATE KEY UPDATE/,
    )?.[0];
    const roles = migration.match(/INSERT INTO `PlatformRole`[\s\S]*?ON DUPLICATE KEY UPDATE/)?.[0];

    expect(codes(permissions ?? '')).toEqual([
      'platform.read',
      'platform.manage',
      'platform.settings.read',
      'platform.settings.manage',
      'platform_users.read',
      'platform_users.create',
      'platform_users.update',
      'platform_users.disable',
      'platform_users.enable',
      'platform_users.assign_roles',
      'roles.read',
      'roles.create',
      'roles.update',
      'roles.assign',
      'sessions.read',
      'sessions.revoke',
      'audit_logs.read',
      'security_events.read',
      'security_events.update',
      'security_events.resolve',
      'system_health.read',
    ]);
    expect(codes(roles ?? '')).toEqual([
      'OWNER',
      'SUPER_ADMIN',
      'PLATFORM_ADMIN',
      'SECURITY_ADMIN',
      'SUPPORT_ADMIN',
    ]);
  });

  it('assigns only the specified permissions to each seeded role', () => {
    const broadAssignment = migration.match(
      /INSERT IGNORE INTO `PlatformRolePermission`[\s\S]*?WHERE `role`.`code` IN \(([^)]*)\);/,
    )?.[1];
    const assignmentFor = (role: string): string[] => {
      const statement = migration
        .split('INSERT IGNORE INTO `PlatformRolePermission`')
        .find((candidate) => candidate.includes(`WHERE \`role\`.\`code\` = '${role}'`));
      return codes(
        statement?.match(
          /JOIN `PlatformPermission` AS `permission` ON `permission`.`code` IN \(([\s\S]*?)\)/,
        )?.[1] ?? '',
      );
    };

    expect(codes(broadAssignment ?? '')).toEqual(['OWNER', 'SUPER_ADMIN']);
    expect(migration).toContain('CROSS JOIN `PlatformPermission` AS `permission`');
    expect(assignmentFor('PLATFORM_ADMIN')).toEqual([
      'platform.read',
      'platform_users.read',
      'platform_users.create',
      'platform_users.update',
      'platform_users.disable',
      'platform_users.enable',
      'platform_users.assign_roles',
      'roles.read',
      'roles.assign',
    ]);
    expect(assignmentFor('SECURITY_ADMIN')).toEqual([
      'sessions.read',
      'sessions.revoke',
      'audit_logs.read',
      'security_events.read',
      'security_events.update',
      'security_events.resolve',
      'system_health.read',
    ]);
    expect(assignmentFor('SUPPORT_ADMIN')).toEqual([
      'platform.read',
      'platform_users.read',
      'system_health.read',
    ]);
  });
});
