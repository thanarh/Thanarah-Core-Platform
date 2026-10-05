import { TenantStatus } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../src/database/prisma.service';
import {
  DEFAULT_TENANT_ROLES,
  TENANT_PERMISSION_DEFINITIONS,
} from '../src/tenant/tenant-authorization.constants';
import {
  TenantOwnerBootstrapConflictError,
  TenantPermissionCatalogUnavailableError,
} from '../src/tenant/tenant-authorization.errors';
import { TenantRoleRepository } from '../src/tenant/tenant-role.repository';

const tenantId = '11111111-1111-4111-8111-111111111111';
const membershipId = '22222222-2222-4222-8222-222222222222';
const roleId = '33333333-3333-4333-8333-333333333333';
const timestamp = new Date('2026-10-05T12:00:00.000Z');

describe('TenantRoleRepository', () => {
  const transaction = {
    $queryRaw: vi.fn(),
    tenant: { findUnique: vi.fn() },
    tenantMembership: { findFirst: vi.fn() },
    tenantMembershipRole: { create: vi.fn(), findFirst: vi.fn() },
    tenantPermission: { findMany: vi.fn() },
    tenantRole: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      updateMany: vi.fn(),
      upsert: vi.fn(),
    },
    tenantRolePermission: {
      createMany: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (callback: (client: typeof transaction) => Promise<unknown>) =>
      callback(transaction),
    ),
    tenantRole: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  const repository = new TenantRoleRepository(prisma as unknown as PrismaService);

  beforeEach(() => vi.clearAllMocks());

  it('creates, finds, and lists roles using tenant-scoped filters', async () => {
    prisma.tenantRole.create.mockResolvedValue({ id: roleId });
    prisma.tenantRole.findFirst.mockResolvedValue(null);
    prisma.tenantRole.findMany.mockResolvedValue([]);

    await repository.create({ tenantId, code: 'REPORT_VIEWER', name: 'Report Viewer' });
    await repository.findByIdForTenant(tenantId, roleId);
    await repository.listForTenant(tenantId);

    expect(prisma.tenantRole.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          tenantId,
          code: 'REPORT_VIEWER',
          name: 'Report Viewer',
          description: null,
        },
      }),
    );
    expect(prisma.tenantRole.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId, id: roleId } }),
    );
    expect(prisma.tenantRole.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId } }),
    );
  });

  it('updates only custom roles within the same tenant', async () => {
    prisma.tenantRole.updateMany.mockResolvedValue({ count: 1 });
    prisma.tenantRole.findFirst.mockResolvedValue({ id: roleId });

    await repository.updateMetadata(tenantId, roleId, { name: 'Analyst' });

    expect(prisma.tenantRole.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId, id: roleId, isSystemRole: false },
        data: { name: 'Analyst' },
      }),
    );
    expect(prisma.tenantRole.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId, id: roleId } }),
    );
  });

  it('replaces permissions atomically and rejects missing catalog entries', async () => {
    const selectedPermission = TENANT_PERMISSION_DEFINITIONS[0];
    transaction.tenantRole.findFirst
      .mockResolvedValueOnce({ id: roleId, isSystemRole: false })
      .mockResolvedValueOnce({ id: roleId, permissions: [] });
    transaction.tenantPermission.findMany.mockResolvedValue([
      { id: '44444444-4444-4444-8444-444444444444', code: selectedPermission.code },
    ]);
    transaction.tenantRolePermission.deleteMany.mockResolvedValue({ count: 0 });
    transaction.tenantRolePermission.createMany.mockResolvedValue({ count: 1 });

    await repository.replacePermissions(tenantId, roleId, [selectedPermission.code]);

    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(transaction.tenantRole.findFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { tenantId, id: roleId, isSystemRole: false },
      }),
    );
    expect(transaction.tenantPermission.findMany).toHaveBeenCalledWith({
      where: { code: { in: [selectedPermission.code] } },
      select: { id: true, code: true },
    });
    expect(transaction.tenantRolePermission.deleteMany).toHaveBeenCalledWith({
      where: { tenantRoleId: roleId },
    });

    transaction.tenantRole.findFirst.mockResolvedValueOnce({ id: roleId, isSystemRole: false });
    transaction.tenantPermission.findMany.mockResolvedValueOnce([]);
    await expect(
      repository.replacePermissions(tenantId, roleId, [selectedPermission.code]),
    ).rejects.toBeInstanceOf(TenantPermissionCatalogUnavailableError);
  });

  it('creates default roles and the initial owner assignment in one transaction', async () => {
    transaction.$queryRaw.mockResolvedValue([{ id: tenantId }]);
    transaction.tenant.findUnique.mockResolvedValue({ status: TenantStatus.ACTIVE });
    transaction.tenantMembership.findFirst.mockResolvedValue({ id: membershipId });
    transaction.tenantMembershipRole.findFirst.mockResolvedValue(null);
    transaction.tenantRole.findUnique.mockResolvedValue(null);
    transaction.tenantPermission.findMany.mockResolvedValue(
      TENANT_PERMISSION_DEFINITIONS.map((permission, index) => ({
        id: `permission-${index}`,
        code: permission.code,
      })),
    );
    transaction.tenantRole.upsert.mockImplementation(
      async (input: { where: { tenantId_code: { code: string } } }) => ({
        id: `role-${input.where.tenantId_code.code}`,
      }),
    );
    transaction.tenantRolePermission.deleteMany.mockResolvedValue({ count: 0 });
    transaction.tenantRolePermission.createMany.mockResolvedValue({ count: 1 });
    transaction.tenantRole.findUniqueOrThrow.mockResolvedValue({ id: 'role-OWNER' });
    transaction.tenantRole.findMany.mockResolvedValue(
      DEFAULT_TENANT_ROLES.map((role) => ({
        id: `role-${role.code}`,
        tenantId,
        code: role.code,
        name: role.name,
        description: role.description,
        isSystemRole: true,
        createdAt: timestamp,
        updatedAt: timestamp,
        permissions: role.permissionCodes.map((code) => ({ permission: { code } })),
      })),
    );

    const result = await repository.bootstrapInitialOwner({
      tenantId,
      platformUserId: '55555555-5555-4555-8555-555555555555',
    });

    expect(result.ownerMembershipId).toBe(membershipId);
    expect(result.roles).toHaveLength(DEFAULT_TENANT_ROLES.length);
    expect(result.createdRoleCodes).toEqual(DEFAULT_TENANT_ROLES.map(({ code }) => code));
    expect(result.updatedPermissionRoleCodes).toEqual([]);
    expect(transaction.tenantRole.upsert).toHaveBeenCalledTimes(DEFAULT_TENANT_ROLES.length);
    expect(transaction.tenantMembershipRole.create).toHaveBeenCalledWith({
      data: {
        tenantId,
        membershipId,
        tenantRoleId: 'role-OWNER',
      },
    });
    expect(transaction.tenantMembershipRole.findFirst).toHaveBeenCalledWith({
      where: { tenantId, role: { is: { code: 'OWNER' } } },
      select: { membershipId: true },
    });
    expect(transaction.tenantRole.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId, code: { in: ['OWNER', 'ADMIN', 'MEMBER'] } } }),
    );
  });

  it('refuses bootstrap without an active membership and fails if the permission catalog is incomplete', async () => {
    transaction.$queryRaw.mockResolvedValue([{ id: tenantId }]);
    transaction.tenant.findUnique.mockResolvedValue({ status: TenantStatus.ACTIVE });
    transaction.tenantMembership.findFirst.mockResolvedValue(null);

    await expect(
      repository.bootstrapInitialOwner({ tenantId, platformUserId: 'user-id' }),
    ).rejects.toBeInstanceOf(TenantOwnerBootstrapConflictError);
    expect(transaction.tenantPermission.findMany).not.toHaveBeenCalled();

    transaction.tenantMembership.findFirst.mockResolvedValueOnce({ id: membershipId });
    transaction.tenantMembershipRole.findFirst.mockResolvedValueOnce(null);
    transaction.tenantRole.findUnique.mockResolvedValue(null);
    transaction.tenantPermission.findMany.mockResolvedValueOnce([]);
    await expect(
      repository.bootstrapInitialOwner({ tenantId, platformUserId: 'user-id' }),
    ).rejects.toBeInstanceOf(TenantPermissionCatalogUnavailableError);
    expect(transaction.tenantRole.upsert).not.toHaveBeenCalled();
  });

  it('enforces active tenant and membership status before bootstrap', async () => {
    transaction.$queryRaw.mockResolvedValue([{ id: tenantId }]);
    transaction.tenant.findUnique.mockResolvedValue({ status: TenantStatus.SUSPENDED });

    await expect(
      repository.bootstrapInitialOwner({ tenantId, platformUserId: 'user-id' }),
    ).rejects.toBeInstanceOf(TenantOwnerBootstrapConflictError);
    expect(transaction.tenantMembership.findFirst).not.toHaveBeenCalled();
  });

  it('seeds the central tenant permission catalog and constrains assignments to one tenant', () => {
    const migration = [
      'prisma/migrations/20261005153000_tenant_roles_permissions_foundation/migration.sql',
      'prisma/migrations/20261006100000_facility_foundation/migration.sql',
    ]
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');

    for (const { code } of TENANT_PERMISSION_DEFINITIONS) {
      expect(migration).toContain(`'${code}'`);
    }
    expect(migration).toMatch(
      /FOREIGN KEY \(`membershipId`, `tenantId`\) REFERENCES `TenantMembership` \(`id`, `tenantId`\)/,
    );
    expect(migration).toMatch(
      /FOREIGN KEY \(`tenantRoleId`, `tenantId`\) REFERENCES `TenantRole` \(`id`, `tenantId`\)/,
    );
  });
});
