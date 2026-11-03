import { Inject, Injectable } from '@nestjs/common';
import { PlatformAuditEventType } from '@prisma/client';
import { z } from 'zod';
import type { AuthenticatedPlatformUser } from '../auth/auth.types';
import { PlatformAuditService } from '../platform-security/platform-audit.service';
import type { TrustedSecurityContext } from '../platform-security/platform-security.types';
import {
  TenantOwnerAssignmentForbiddenError,
  TenantOwnerProtectionError,
} from './tenant-authorization.errors';
import { tenantRoleIdSchema } from './tenant-role.dto';
import { TenantContextInvalidError, TenantContextRequiredError } from './tenant-context.contract';
import type { TrustedTenantContext } from './tenant-context.contract';
import { tenantIdSchema } from './tenant.dto';
import { tenantStaffIdSchema } from './tenant-staff.dto';
import {
  createTenantStaffRoleAssignmentSchema,
  type CreateTenantStaffRoleAssignmentInput,
} from './tenant-staff-role.dto';
import {
  TenantStaffRoleAssignmentConflictError,
  TenantStaffRoleAssignmentInputValidationError,
  TenantStaffRoleAssignmentNotFoundError,
  TenantStaffRoleSelfAssignmentError,
} from './tenant-staff-role.errors';
import {
  TENANT_STAFF_ROLE_PERSISTENCE,
  type TenantStaffRoleAssignmentRecord,
  type TenantStaffRolePersistencePort,
} from '../persistence/platform-persistence.ports';

export type TenantStaffRoleAuditContext = Pick<
  TrustedSecurityContext,
  'requestId' | 'ipAddress' | 'userAgent'
>;

export interface TenantStaffRoleAssignmentResponse {
  staffId: string;
  roleId: string;
  roleCode: string;
  roleName: string;
  roleDescription: string | null;
  isSystemRole: boolean;
  assignedAt: Date;
}

export interface TenantStaffRoleAssignmentListResponse {
  items: TenantStaffRoleAssignmentResponse[];
}

@Injectable()
export class TenantStaffRoleService {
  constructor(
    @Inject(TENANT_STAFF_ROLE_PERSISTENCE)
    private readonly assignments: TenantStaffRolePersistencePort,
    private readonly audit: PlatformAuditService,
  ) {}

  async list(
    context: TrustedTenantContext,
    staffId: string,
  ): Promise<TenantStaffRoleAssignmentListResponse> {
    const tenantId = this.trustedTenantId(context);
    const id = this.staffId(staffId);
    const records = await this.assignments.listForStaff(tenantId, id);
    if (!records) throw new TenantStaffRoleAssignmentNotFoundError();
    return { items: records.map((record) => this.present(record)) };
  }

  async assign(
    context: TrustedTenantContext,
    staffId: string,
    input: CreateTenantStaffRoleAssignmentInput,
    actor: AuthenticatedPlatformUser,
    requestContext: TenantStaffRoleAuditContext = {},
  ): Promise<TenantStaffRoleAssignmentResponse> {
    const tenantId = this.trustedTenantId(context);
    this.assertActor(context, actor);
    const staff = this.staffId(staffId);
    const parsed = createTenantStaffRoleAssignmentSchema.safeParse(input);
    if (!parsed.success) throw new TenantStaffRoleAssignmentInputValidationError();
    const roleId = this.roleId(parsed.data.roleId);

    const result = await this.assignments.assign({
      tenantId,
      actorMembershipId: context.membershipId,
      actorPlatformUserId: actor.userId,
      staffId: staff,
      roleId,
    });
    if (result.kind === 'not-found') throw new TenantStaffRoleAssignmentNotFoundError();
    if (result.kind === 'staff-ineligible') throw new TenantStaffRoleAssignmentConflictError();
    if (result.kind === 'self-assignment') throw new TenantStaffRoleSelfAssignmentError();
    if (result.kind === 'owner-only') throw new TenantOwnerAssignmentForbiddenError();

    if (result.kind === 'changed') {
      await this.audit.recordAudit({
        eventType: PlatformAuditEventType.STAFF_ROLE_ASSIGNED,
        actorUserId: actor.userId,
        subjectUserId: result.assignment.staff.userId,
        subjectTenantId: tenantId,
        sessionId: actor.sessionId,
        ...requestContext,
        metadata: {
          staffId: result.assignment.staffId,
          roleId: result.assignment.tenantRoleId,
          roleCode: result.assignment.role.code,
          result: 'assigned',
        },
      });
    }
    return this.present(result.assignment);
  }

  async remove(
    context: TrustedTenantContext,
    staffId: string,
    roleId: string,
    actor: AuthenticatedPlatformUser,
    requestContext: TenantStaffRoleAuditContext = {},
  ): Promise<void> {
    const tenantId = this.trustedTenantId(context);
    this.assertActor(context, actor);
    const staff = this.staffId(staffId);
    const role = this.roleId(roleId);
    const result = await this.assignments.remove({
      tenantId,
      actorMembershipId: context.membershipId,
      actorPlatformUserId: actor.userId,
      staffId: staff,
      roleId: role,
    });

    if (result.kind === 'not-found' || result.kind === 'not-assigned') {
      throw new TenantStaffRoleAssignmentNotFoundError();
    }
    if (result.kind === 'actor-ineligible') throw new TenantContextInvalidError();
    if (result.kind === 'owner-protected') throw new TenantOwnerProtectionError();

    await this.audit.recordAudit({
      eventType: PlatformAuditEventType.STAFF_ROLE_REMOVED,
      actorUserId: actor.userId,
      subjectUserId: result.userId,
      subjectTenantId: tenantId,
      sessionId: actor.sessionId,
      ...requestContext,
      metadata: {
        staffId: staff,
        roleId: role,
        roleCode: result.roleCode,
        result: 'removed',
      },
    });
  }

  private trustedTenantId(context: TrustedTenantContext): string {
    if (!context) throw new TenantContextRequiredError();
    if (
      !tenantIdSchema.safeParse(context.tenantId).success ||
      !z.string().uuid().safeParse(context.membershipId).success ||
      !z.string().uuid().safeParse(context.platformUserId).success
    ) {
      throw new TenantContextInvalidError();
    }
    return context.tenantId.toLowerCase();
  }

  private assertActor(context: TrustedTenantContext, actor: AuthenticatedPlatformUser): void {
    if (
      !actor ||
      typeof actor.userId !== 'string' ||
      actor.userId.toLowerCase() !== context.platformUserId.toLowerCase()
    ) {
      throw new TenantContextInvalidError();
    }
  }

  private staffId(staffId: string): string {
    const parsed = tenantStaffIdSchema.safeParse(staffId);
    if (!parsed.success) throw new TenantStaffRoleAssignmentInputValidationError();
    return parsed.data.toLowerCase();
  }

  private roleId(roleId: string): string {
    const parsed = tenantRoleIdSchema.safeParse(roleId);
    if (!parsed.success) throw new TenantStaffRoleAssignmentInputValidationError();
    return parsed.data.toLowerCase();
  }

  private present(record: TenantStaffRoleAssignmentRecord): TenantStaffRoleAssignmentResponse {
    return {
      staffId: record.staffId,
      roleId: record.tenantRoleId,
      roleCode: record.role.code,
      roleName: record.role.name,
      roleDescription: record.role.description,
      isSystemRole: record.role.isSystemRole,
      assignedAt: record.assignedAt,
    };
  }
}
