import { Injectable } from '@nestjs/common';
import { Prisma, TenantMembershipStatus, TenantStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import {
  DEFAULT_TENANT_ROLES,
  TENANT_PERMISSION_DEFINITIONS,
  type TenantPermissionCode,
} from './tenant-authorization.constants';
import {
  TenantOwnerBootstrapConflictError,
  TenantPermissionCatalogUnavailableError,
} from './tenant-authorization.errors';
import type {
  TenantRoleBootstrapResult,
  TenantRoleRecord as TenantRolePortRecord,
  TenantRolePersistencePort,
} from '../persistence/platform-persistence.ports';

export const tenantRoleSelect = {
  id: true,
  tenantId: true,
  code: true,
  name: true,
  description: true,
  isSystemRole: true,
  createdAt: true,
  updatedAt: true,
  permissions: {
    select: {
      permission: { select: { code: true } },
    },
  },
} satisfies Prisma.TenantRoleSelect;

export type TenantRoleRecord = TenantRolePortRecord;

@Injectable()
export class TenantRoleRepository implements TenantRolePersistencePort {
  constructor(private readonly prisma: PrismaService) {}

  create(input: {
    tenantId: string;
    code: string;
    name: string;
    description?: string | null;
  }): Promise<TenantRoleRecord> {
    return this.prisma.tenantRole.create({
      data: {
        ...input,
        description: input.description ?? null,
      },
      select: tenantRoleSelect,
    });
  }

  findByIdForTenant(tenantId: string, id: string): Promise<TenantRoleRecord | null> {
    return this.prisma.tenantRole.findFirst({
      where: { tenantId, id },
      select: tenantRoleSelect,
    });
  }

  listForTenant(tenantId: string): Promise<TenantRoleRecord[]> {
    return this.prisma.tenantRole.findMany({
      where: { tenantId },
      orderBy: [{ isSystemRole: 'desc' }, { code: 'asc' }],
      select: tenantRoleSelect,
    });
  }

  async updateMetadata(
    tenantId: string,
    id: string,
    input: { name?: string; description?: string | null },
  ): Promise<TenantRoleRecord | null> {
    const result = await this.prisma.tenantRole.updateMany({
      where: { tenantId, id, isSystemRole: false },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
      },
    });
    if (result.count !== 1) return null;
    return this.findByIdForTenant(tenantId, id);
  }

  async replacePermissions(
    tenantId: string,
    roleId: string,
    permissionCodes: readonly TenantPermissionCode[],
  ): Promise<TenantRoleRecord | null> {
    return this.prisma.$transaction(async (transaction) => {
      const role = await transaction.tenantRole.findFirst({
        where: { tenantId, id: roleId, isSystemRole: false },
        select: { id: true },
      });
      if (!role) return null;

      const permissions = await transaction.tenantPermission.findMany({
        where: { code: { in: [...permissionCodes] } },
        select: { id: true, code: true },
      });
      if (permissions.length !== permissionCodes.length) {
        throw new TenantPermissionCatalogUnavailableError();
      }

      await transaction.tenantRolePermission.deleteMany({ where: { tenantRoleId: roleId } });
      if (permissions.length > 0) {
        await transaction.tenantRolePermission.createMany({
          data: permissions.map((permission) => ({
            tenantRoleId: roleId,
            tenantPermissionId: permission.id,
          })),
        });
      }

      return transaction.tenantRole.findFirst({
        where: { tenantId, id: roleId },
        select: tenantRoleSelect,
      });
    });
  }

  async bootstrapInitialOwner(input: {
    tenantId: string;
    platformUserId: string;
  }): Promise<TenantRoleBootstrapResult> {
    return this.prisma.$transaction(async (transaction) => {
      const lockedTenant = await transaction.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT \`id\` FROM \`Tenant\` WHERE \`id\` = ${input.tenantId} FOR UPDATE`,
      );
      if (lockedTenant.length === 0) throw new TenantOwnerBootstrapConflictError();

      const tenant = await transaction.tenant.findUnique({
        where: { id: input.tenantId },
        select: { status: true },
      });
      if (!tenant || tenant.status !== TenantStatus.ACTIVE) {
        throw new TenantOwnerBootstrapConflictError();
      }

      const membership = await transaction.tenantMembership.findFirst({
        where: {
          tenantId: input.tenantId,
          platformUserId: input.platformUserId,
          status: TenantMembershipStatus.ACTIVE,
        },
        select: { id: true },
      });
      if (!membership) throw new TenantOwnerBootstrapConflictError();

      const existingOwner = await transaction.tenantMembershipRole.findFirst({
        where: { tenantId: input.tenantId, role: { is: { code: 'OWNER' } } },
        select: { membershipId: true },
      });
      if (existingOwner) throw new TenantOwnerBootstrapConflictError();

      const roleCodes = DEFAULT_TENANT_ROLES.map((role) => role.code);
      const existingRoles = new Map<string, { id: string; isSystemRole: boolean }>();
      for (const code of roleCodes) {
        const existingRole = await transaction.tenantRole.findUnique({
          where: { tenantId_code: { tenantId: input.tenantId, code } },
          select: { id: true, isSystemRole: true },
        });
        if (existingRole && !existingRole.isSystemRole) {
          throw new TenantOwnerBootstrapConflictError();
        }
        if (existingRole) existingRoles.set(code, existingRole);
      }

      const permissionCodes = TENANT_PERMISSION_DEFINITIONS.map(({ code }) => code);
      const permissions = await transaction.tenantPermission.findMany({
        where: { code: { in: permissionCodes } },
        select: { id: true, code: true },
      });
      if (permissions.length !== permissionCodes.length) {
        throw new TenantPermissionCatalogUnavailableError();
      }
      const permissionIds = new Map(permissions.map(({ id, code }) => [code, id]));
      const createdRoleCodes: string[] = [];
      const updatedPermissionRoleCodes: string[] = [];

      for (const definition of DEFAULT_TENANT_ROLES) {
        const existingRole = existingRoles.get(definition.code);
        if (!existingRole) {
          createdRoleCodes.push(definition.code);
        } else {
          const existingPermissions = await transaction.tenantRolePermission.findMany({
            where: { tenantRoleId: existingRole.id },
            select: { permission: { select: { code: true } } },
          });
          const before = existingPermissions
            .map(({ permission }) => permission.code)
            .sort((left, right) => left.localeCompare(right));
          const after = [...definition.permissionCodes].sort((left, right) =>
            left.localeCompare(right),
          );
          if (before.join(',') !== after.join(',')) {
            updatedPermissionRoleCodes.push(definition.code);
          }
        }

        const role = await transaction.tenantRole.upsert({
          where: { tenantId_code: { tenantId: input.tenantId, code: definition.code } },
          create: {
            tenantId: input.tenantId,
            code: definition.code,
            name: definition.name,
            description: definition.description,
            isSystemRole: true,
          },
          update: {
            name: definition.name,
            description: definition.description,
            isSystemRole: true,
          },
          select: { id: true },
        });

        await transaction.tenantRolePermission.deleteMany({
          where: { tenantRoleId: role.id },
        });
        await transaction.tenantRolePermission.createMany({
          data: definition.permissionCodes.map((code) => {
            const tenantPermissionId = permissionIds.get(code);
            if (!tenantPermissionId) throw new TenantPermissionCatalogUnavailableError();
            return { tenantRoleId: role.id, tenantPermissionId };
          }),
        });
      }

      const ownerRole = await transaction.tenantRole.findUniqueOrThrow({
        where: { tenantId_code: { tenantId: input.tenantId, code: 'OWNER' } },
        select: { id: true },
      });
      await transaction.tenantMembershipRole.create({
        data: {
          tenantId: input.tenantId,
          membershipId: membership.id,
          tenantRoleId: ownerRole.id,
        },
      });

      const roles = await transaction.tenantRole.findMany({
        where: { tenantId: input.tenantId, code: { in: roleCodes } },
        orderBy: { code: 'asc' },
        select: tenantRoleSelect,
      });
      return {
        ownerMembershipId: membership.id,
        roles,
        createdRoleCodes,
        updatedPermissionRoleCodes,
      };
    });
  }
}
