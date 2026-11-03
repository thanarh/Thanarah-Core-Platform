import { Injectable } from '@nestjs/common';
import type { ZodType } from 'zod';
import {
  PLATFORM_PERMISSION_CODES,
  PLATFORM_ROLE_CODES,
  type PlatformPermissionCode,
  type PlatformRoleCode,
} from '../auth/platform-authorization.constants';
import type { PlatformAuthorizationPersistencePort } from '../persistence/platform-persistence.ports';
import { PlatformMongoClientManager } from './platform-mongo.client.manager';
import {
  PlatformDocumentValidationError,
  PlatformMongoUnavailableError,
} from './platform-mongo.errors';
import {
  platformPermissionSchema,
  platformRolePermissionSchema,
  platformRoleSchema,
  platformUserRoleSchema,
} from './platform-mongo.models';
import type {
  PlatformPermissionDocument,
  PlatformRoleDocument,
  PlatformRolePermissionDocument,
  PlatformUserRoleDocument,
} from './platform-mongo.models';

const AUTHORIZATION_READ_TRANSACTION_OPTIONS = {
  readConcern: { level: 'snapshot' as const },
};

@Injectable()
export class MongoPlatformAuthorizationRepository implements PlatformAuthorizationPersistencePort {
  constructor(private readonly manager: PlatformMongoClientManager) {}

  findRoleCodesByUserId(userId: string): Promise<PlatformRoleCode[]> {
    return this.read(() =>
      this.manager.withTransaction(async (session) => {
        const db = await this.manager.getDatabase();
        const assignments = await db
          .collection<PlatformUserRoleDocument>('platform_user_roles')
          .find({ userId }, { session })
          .toArray();
        const roleIds = assignments.map(
          (document) => this.parse(platformUserRoleSchema, document).roleId,
        );
        if (roleIds.length === 0) return [];

        const roles = await db
          .collection<PlatformRoleDocument>('platform_roles')
          .find({ _id: { $in: [...new Set(roleIds)] } }, { session })
          .toArray();
        const parsedRoles = roles.map((document) => this.parse(platformRoleSchema, document));
        this.assertReferencesResolved(
          roleIds,
          parsedRoles.map(({ _id }) => _id),
        );
        return parsedRoles.map(({ code }) => this.roleCode(code));
      }, AUTHORIZATION_READ_TRANSACTION_OPTIONS),
    );
  }

  findRoleIdsByUserId(userId: string): Promise<string[]> {
    return this.read(() =>
      this.manager.withTransaction(async (session) => {
        const db = await this.manager.getDatabase();
        const assignments = await db
          .collection<PlatformUserRoleDocument>('platform_user_roles')
          .find({ userId }, { session })
          .toArray();
        const roleIds = assignments.map(
          (document) => this.parse(platformUserRoleSchema, document).roleId,
        );
        if (roleIds.length === 0) return [];
        const roles = await db
          .collection<PlatformRoleDocument>('platform_roles')
          .find({ _id: { $in: [...new Set(roleIds)] } }, { session })
          .toArray();
        const parsedRoles = roles.map((document) => this.parse(platformRoleSchema, document));
        this.assertReferencesResolved(
          roleIds,
          parsedRoles.map(({ _id }) => _id),
        );
        return roleIds;
      }, AUTHORIZATION_READ_TRANSACTION_OPTIONS),
    );
  }

  findPermissionCodesByUserId(userId: string): Promise<PlatformPermissionCode[]> {
    return this.read(() =>
      this.manager.withTransaction(async (session) => {
        const db = await this.manager.getDatabase();
        const assignments = await db
          .collection<PlatformUserRoleDocument>('platform_user_roles')
          .find({ userId }, { session })
          .toArray();
        const roleIds = assignments.map(
          (document) => this.parse(platformUserRoleSchema, document).roleId,
        );
        if (roleIds.length === 0) return [];

        const uniqueRoleIds = [...new Set(roleIds)];
        const roles = await db
          .collection<PlatformRoleDocument>('platform_roles')
          .find({ _id: { $in: uniqueRoleIds } }, { session })
          .toArray();
        const parsedRoles = roles.map((document) => this.parse(platformRoleSchema, document));
        this.assertReferencesResolved(
          uniqueRoleIds,
          parsedRoles.map(({ _id }) => _id),
        );

        const rolePermissions = await db
          .collection<PlatformRolePermissionDocument>('platform_role_permissions')
          .find({ roleId: { $in: uniqueRoleIds } }, { session })
          .toArray();
        const parsedAssignments = rolePermissions.map((document) =>
          this.parse(platformRolePermissionSchema, document),
        );
        const permissionIds = parsedAssignments.map(({ permissionId }) => permissionId);
        if (permissionIds.length === 0) return [];

        const uniquePermissionIds = [...new Set(permissionIds)];
        const permissions = await db
          .collection<PlatformPermissionDocument>('platform_permissions')
          .find({ _id: { $in: uniquePermissionIds } }, { session })
          .toArray();
        const parsedPermissions = permissions.map((document) =>
          this.parse(platformPermissionSchema, document),
        );
        this.assertReferencesResolved(
          uniquePermissionIds,
          parsedPermissions.map(({ _id }) => _id),
        );
        return [...new Set(parsedPermissions.map(({ code }) => this.permissionCode(code)))];
      }, AUTHORIZATION_READ_TRANSACTION_OPTIONS),
    );
  }

  private async read<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof PlatformDocumentValidationError) throw error;
      throw new PlatformMongoUnavailableError();
    }
  }

  private parse<T>(schema: ZodType<T>, value: unknown): T {
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new PlatformDocumentValidationError();
    return parsed.data;
  }

  private roleCode(value: string): PlatformRoleCode {
    if (!(PLATFORM_ROLE_CODES as readonly string[]).includes(value)) {
      throw new PlatformDocumentValidationError();
    }
    return value as PlatformRoleCode;
  }

  private permissionCode(value: string): PlatformPermissionCode {
    if (!(PLATFORM_PERMISSION_CODES as readonly string[]).includes(value)) {
      throw new PlatformDocumentValidationError();
    }
    return value as PlatformPermissionCode;
  }

  private assertReferencesResolved(references: readonly string[], found: readonly string[]): void {
    const foundIds = new Set(found);
    if (new Set(references).size !== foundIds.size || references.some((id) => !foundIds.has(id))) {
      throw new PlatformDocumentValidationError();
    }
  }
}
