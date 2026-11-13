import { Inject, Injectable } from '@nestjs/common';
import { PlatformAuditEventType } from '../common/domain-enums';
import { isLegacyUniqueConstraintError } from '../common/legacy-unique-constraint';
import { z } from 'zod';
import { AuthorizationForbiddenError } from '../auth/errors/authorization.errors';
import type { AuthenticatedPlatformUser } from '../auth/auth.types';
import type { PlatformPermissionCode } from '../auth/platform-authorization.constants';
import { PlatformAuthorizationService } from '../auth/services/platform-authorization.service';
import { PlatformAuditService } from '../platform-security/platform-audit.service';
import type { TrustedSecurityContext } from '../platform-security/platform-security.types';
import {
  DEFAULT_TENANT_ROLES,
  TENANT_OWNER_PERMISSION_CODE,
} from './tenant-authorization.constants';
import {
  TenantMembershipRoleTargetNotFoundError,
  TenantOwnerAssignmentForbiddenError,
  TenantOwnerProtectionError,
  TenantPermissionAssignmentInvalidError,
  TenantRoleCodeConflictError,
  TenantRoleInputValidationError,
  TenantRoleNotFoundError,
  TenantSelfRoleAssignmentError,
  TenantSystemRoleProtectedError,
} from './tenant-authorization.errors';
import { TenantAuthorizationService } from './tenant-authorization.service';
import type { TrustedTenantContext } from './tenant-context.contract';
import { TenantContextInvalidError } from './tenant-context.contract';
import { tenantIdSchema } from './tenant.dto';
import {
  bootstrapTenantOwnerSchema,
  createTenantRoleSchema,
  replaceTenantRolePermissionsSchema,
  tenantRoleIdSchema,
  updateTenantRoleSchema,
  type BootstrapTenantOwnerInput,
  type CreateTenantRoleInput,
  type ReplaceTenantRolePermissionsInput,
  type UpdateTenantRoleInput,
} from './tenant-role.dto';
import {
  TENANT_MEMBERSHIP_ROLE_PERSISTENCE,
  TENANT_ROLE_PERSISTENCE,
} from '../persistence/platform-persistence.ports';
import type {
  TenantMembershipRolePersistencePort,
  TenantRolePersistencePort,
  TenantRoleRecord,
} from '../persistence/platform-persistence.ports';

export type TenantRoleAuditContext = Pick<
  TrustedSecurityContext,
  'requestId' | 'ipAddress' | 'userAgent'
>;

const DEFAULT_ROLE_CODES = new Set<string>(DEFAULT_TENANT_ROLES.map(({ code }) => code));

/**
 * Route-level tenant permissions are enforced by TenantAuthorizationGuard.
 * Keep only role-dependent authorization checks, such as OWNER assignment, here.
 */
@Injectable()
export class TenantRoleService {
  constructor(
    @Inject(TENANT_ROLE_PERSISTENCE) private readonly roles: TenantRolePersistencePort,
    @Inject(TENANT_MEMBERSHIP_ROLE_PERSISTENCE)
    private readonly membershipRoles: TenantMembershipRolePersistencePort,
    private readonly tenantAuthorization: TenantAuthorizationService,
    private readonly platformAuthorization: PlatformAuthorizationService,
    private readonly audit: PlatformAuditService,
  ) {}

  async listRoles(context: TrustedTenantContext): Promise<ReturnType<typeof presentTenantRole>[]> {
    return (await this.roles.listForTenant(context.tenantId)).map(presentTenantRole);
  }

  async getRole(
    context: TrustedTenantContext,
    roleId: string,
  ): Promise<ReturnType<typeof presentTenantRole>> {
    this.assertRoleId(roleId);
    const role = await this.roles.findByIdForTenant(context.tenantId, roleId);
    if (!role) throw new TenantRoleNotFoundError();
    return presentTenantRole(role);
  }

  async createRole(
    context: TrustedTenantContext,
    input: CreateTenantRoleInput,
    actor: AuthenticatedPlatformUser,
    requestContext: TenantRoleAuditContext = {},
  ): Promise<ReturnType<typeof presentTenantRole>> {
    this.assertActor(context, actor);
    const parsed = createTenantRoleSchema.safeParse(input);
    if (!parsed.success) throw new TenantRoleInputValidationError();
    if (DEFAULT_ROLE_CODES.has(parsed.data.code)) throw new TenantRoleInputValidationError();

    let role: TenantRoleRecord;
    try {
      role = await this.roles.create({
        tenantId: context.tenantId,
        ...parsed.data,
      });
    } catch (error) {
      if (this.isUniqueConflict(error)) throw new TenantRoleCodeConflictError();
      throw error;
    }

    await this.audit.recordAudit({
      eventType: PlatformAuditEventType.TENANT_ROLE_CREATED,
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      subjectTenantId: context.tenantId,
      ...requestContext,
      metadata: { roleId: role.id, roleCode: role.code, isSystemRole: false },
    });
    return presentTenantRole(role);
  }

  async updateRole(
    context: TrustedTenantContext,
    roleId: string,
    input: UpdateTenantRoleInput,
    actor: AuthenticatedPlatformUser,
    requestContext: TenantRoleAuditContext = {},
  ): Promise<ReturnType<typeof presentTenantRole>> {
    this.assertActor(context, actor);
    this.assertRoleId(roleId);
    const parsed = updateTenantRoleSchema.safeParse(input);
    if (!parsed.success) throw new TenantRoleInputValidationError();

    const current = await this.roles.findByIdForTenant(context.tenantId, roleId);
    if (!current) throw new TenantRoleNotFoundError();
    if (current.isSystemRole) throw new TenantSystemRoleProtectedError();

    const updated = await this.roles.updateMetadata(context.tenantId, roleId, parsed.data);
    if (!updated) throw new TenantRoleNotFoundError();

    await this.audit.recordAudit({
      eventType: PlatformAuditEventType.TENANT_ROLE_UPDATED,
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      subjectTenantId: context.tenantId,
      ...requestContext,
      metadata: {
        roleId: updated.id,
        roleCode: updated.code,
        changedFields: Object.keys(parsed.data).join(','),
      },
    });
    return presentTenantRole(updated);
  }

  async replacePermissions(
    context: TrustedTenantContext,
    roleId: string,
    input: ReplaceTenantRolePermissionsInput,
    actor: AuthenticatedPlatformUser,
    requestContext: TenantRoleAuditContext = {},
  ): Promise<ReturnType<typeof presentTenantRole>> {
    this.assertActor(context, actor);
    this.assertRoleId(roleId);
    const parsed = replaceTenantRolePermissionsSchema.safeParse(input);
    if (!parsed.success) throw new TenantRoleInputValidationError();
    if (parsed.data.permissionCodes.includes(TENANT_OWNER_PERMISSION_CODE)) {
      throw new TenantPermissionAssignmentInvalidError();
    }

    const current = await this.roles.findByIdForTenant(context.tenantId, roleId);
    if (!current) throw new TenantRoleNotFoundError();
    if (current.isSystemRole) throw new TenantSystemRoleProtectedError();

    const updated = await this.roles.replacePermissions(
      context.tenantId,
      roleId,
      parsed.data.permissionCodes,
    );
    if (!updated) throw new TenantRoleNotFoundError();

    await this.audit.recordAudit({
      eventType: PlatformAuditEventType.TENANT_ROLE_PERMISSIONS_UPDATED,
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      subjectTenantId: context.tenantId,
      ...requestContext,
      metadata: {
        roleId: updated.id,
        roleCode: updated.code,
        permissionCodes: parsed.data.permissionCodes.join(','),
      },
    });
    return presentTenantRole(updated);
  }

  async listMembershipRoles(
    context: TrustedTenantContext,
    membershipId: string,
  ): Promise<Array<{ assignedAt: Date; role: ReturnType<typeof presentTenantRole> }>> {
    this.assertMembershipId(membershipId);
    const assignments = await this.membershipRoles.listForMembership(
      context.tenantId,
      membershipId,
    );
    if (!assignments) throw new TenantMembershipRoleTargetNotFoundError();
    return assignments.map(({ assignedAt, role }) => ({
      assignedAt,
      role: presentTenantRole(role),
    }));
  }

  async assignRole(
    context: TrustedTenantContext,
    membershipId: string,
    roleId: string,
    actor: AuthenticatedPlatformUser,
    requestContext: TenantRoleAuditContext = {},
  ): Promise<void> {
    this.assertActor(context, actor);
    this.assertMembershipId(membershipId);
    this.assertRoleId(roleId);

    const role = await this.roles.findByIdForTenant(context.tenantId, roleId);
    if (!role) throw new TenantMembershipRoleTargetNotFoundError();
    if (role.code === 'OWNER') {
      await this.tenantAuthorization.authorize(context, TENANT_OWNER_PERMISSION_CODE);
    }

    const result = await this.membershipRoles.assign({
      tenantId: context.tenantId,
      actorMembershipId: context.membershipId,
      actorPlatformUserId: context.platformUserId,
      targetMembershipId: membershipId,
      roleId,
    });
    if (result.kind === 'not-found') throw new TenantMembershipRoleTargetNotFoundError();
    if (result.kind === 'self-assignment') throw new TenantSelfRoleAssignmentError();
    if (result.kind === 'owner-only') throw new TenantOwnerAssignmentForbiddenError();
    if (result.kind === 'already-assigned') return;

    const owner = result.roleCode === 'OWNER';
    await this.audit.recordAudit({
      eventType: owner
        ? PlatformAuditEventType.TENANT_OWNER_ASSIGNED
        : PlatformAuditEventType.TENANT_MEMBERSHIP_ROLE_ASSIGNED,
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      subjectUserId: result.platformUserId,
      subjectTenantId: context.tenantId,
      ...requestContext,
      metadata: { membershipId, roleId, roleCode: result.roleCode },
    });
  }

  async removeRole(
    context: TrustedTenantContext,
    membershipId: string,
    roleId: string,
    actor: AuthenticatedPlatformUser,
    requestContext: TenantRoleAuditContext = {},
  ): Promise<void> {
    this.assertActor(context, actor);
    this.assertMembershipId(membershipId);
    this.assertRoleId(roleId);

    const result = await this.membershipRoles.remove({
      tenantId: context.tenantId,
      membershipId,
      roleId,
    });
    if (result.kind === 'not-found') throw new TenantMembershipRoleTargetNotFoundError();
    if (result.kind === 'owner-protected') throw new TenantOwnerProtectionError();
    if (result.kind === 'not-assigned') throw new TenantMembershipRoleTargetNotFoundError();
    if (result.kind !== 'changed') return;

    await this.audit.recordAudit({
      eventType: PlatformAuditEventType.TENANT_MEMBERSHIP_ROLE_REMOVED,
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      subjectUserId: result.platformUserId,
      subjectTenantId: context.tenantId,
      ...requestContext,
      metadata: { membershipId, roleId, roleCode: result.roleCode },
    });
  }

  async bootstrapInitialOwner(
    tenantId: string,
    input: BootstrapTenantOwnerInput,
    actor: AuthenticatedPlatformUser,
    requestContext: TenantRoleAuditContext = {},
  ): Promise<{
    ownerMembershipId: string;
    roles: ReturnType<typeof presentTenantRole>[];
  }> {
    if (!tenantIdSchema.safeParse(tenantId).success) {
      throw new TenantRoleInputValidationError();
    }
    const parsed = bootstrapTenantOwnerSchema.safeParse(input);
    if (!parsed.success) throw new TenantRoleInputValidationError();
    if (actor.userId.toLowerCase() === parsed.data.platformUserId.toLowerCase()) {
      throw new TenantOwnerAssignmentForbiddenError();
    }

    const permitted = await this.platformAuthorization.hasPermissions(actor.userId, [
      'platform.manage' satisfies PlatformPermissionCode,
    ]);
    if (!permitted) throw new AuthorizationForbiddenError();

    const result = await this.roles.bootstrapInitialOwner({
      tenantId,
      platformUserId: parsed.data.platformUserId,
    });

    for (const role of result.roles) {
      if (!result.createdRoleCodes.includes(role.code)) continue;
      await this.audit.recordAudit({
        eventType: PlatformAuditEventType.TENANT_ROLE_CREATED,
        actorUserId: actor.userId,
        sessionId: actor.sessionId,
        subjectTenantId: tenantId,
        ...requestContext,
        metadata: { roleId: role.id, roleCode: role.code, isSystemRole: true },
      });
    }
    for (const roleCode of result.updatedPermissionRoleCodes) {
      const role = result.roles.find((candidate) => candidate.code === roleCode);
      if (!role) continue;
      await this.audit.recordAudit({
        eventType: PlatformAuditEventType.TENANT_ROLE_PERMISSIONS_UPDATED,
        actorUserId: actor.userId,
        sessionId: actor.sessionId,
        subjectTenantId: tenantId,
        ...requestContext,
        metadata: {
          roleId: role.id,
          roleCode,
          permissionCodes: role.permissions.map(({ permission }) => permission.code).join(','),
        },
      });
    }
    await this.audit.recordAudit({
      eventType: PlatformAuditEventType.TENANT_OWNER_ASSIGNED,
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      subjectUserId: parsed.data.platformUserId,
      subjectTenantId: tenantId,
      ...requestContext,
      metadata: { membershipId: result.ownerMembershipId, roleCode: 'OWNER', bootstrap: true },
    });

    return {
      ownerMembershipId: result.ownerMembershipId,
      roles: result.roles.map(presentTenantRole),
    };
  }

  private assertActor(context: TrustedTenantContext, actor: AuthenticatedPlatformUser): void {
    if (!actor || actor.userId.toLowerCase() !== context.platformUserId.toLowerCase()) {
      throw new TenantContextInvalidError();
    }
  }

  private assertRoleId(roleId: string): void {
    if (!tenantRoleIdSchema.safeParse(roleId).success) throw new TenantRoleInputValidationError();
  }

  private assertMembershipId(membershipId: string): void {
    if (!z.string().uuid().safeParse(membershipId).success) {
      throw new TenantRoleInputValidationError();
    }
  }

  private isUniqueConflict(error: unknown): boolean {
    return isLegacyUniqueConstraintError(error);
  }
}

type TenantRolePresentation = {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description: string | null;
  isSystemRole: boolean;
  permissionCodes: string[];
  createdAt: Date;
  updatedAt: Date;
};

function presentTenantRole(role: TenantRoleRecord): TenantRolePresentation {
  return {
    id: role.id,
    tenantId: role.tenantId,
    code: role.code,
    name: role.name,
    description: role.description,
    isSystemRole: role.isSystemRole,
    permissionCodes: role.permissions
      .map(({ permission }) => permission.code)
      .sort((left, right) => left.localeCompare(right)),
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}
