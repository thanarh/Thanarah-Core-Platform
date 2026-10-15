import { Injectable } from '@nestjs/common';
import { PlatformAuditEventType } from '@prisma/client';
import { z } from 'zod';
import type { AuthenticatedPlatformUser } from '../auth/auth.types';
import { PlatformAuditService } from '../platform-security/platform-audit.service';
import type { TrustedSecurityContext } from '../platform-security/platform-security.types';
import { TenantContextInvalidError, TenantContextRequiredError } from './tenant-context.contract';
import type { TrustedTenantContext } from './tenant-context.contract';
import { tenantIdSchema } from './tenant.dto';
import { tenantStaffIdSchema } from './tenant-staff.dto';
import {
  createTenantStaffBranchAssignmentSchema,
  createTenantStaffFacilityAssignmentSchema,
  tenantStaffScopeBranchIdSchema,
  tenantStaffScopeFacilityIdSchema,
  type CreateTenantStaffBranchAssignmentInput,
  type CreateTenantStaffFacilityAssignmentInput,
} from './tenant-staff-scope.dto';
import {
  TenantStaffScopeConflictError,
  TenantStaffScopeInputValidationError,
  TenantStaffScopeNotFoundError,
} from './tenant-staff-scope.errors';
import {
  TenantStaffScopeRepository,
  type TenantStaffBranchAssignmentRecord,
  type TenantStaffEffectiveScope,
  type TenantStaffFacilityAssignmentRecord,
} from './tenant-staff-scope.repository';

export type TenantStaffScopeAuditContext = Pick<
  TrustedSecurityContext,
  'requestId' | 'ipAddress' | 'userAgent'
>;

export interface TenantStaffFacilityAssignmentResponse {
  staffId: string;
  facilityId: string;
  facilityName: string;
  facilityStatus: TenantStaffFacilityAssignmentRecord['facility']['status'];
  assignedAt: Date;
}

export interface TenantStaffBranchAssignmentResponse {
  staffId: string;
  branchId: string;
  branchName: string;
  branchStatus: TenantStaffBranchAssignmentRecord['branch']['status'];
  facility: {
    id: string;
    name: string;
    status: TenantStaffBranchAssignmentRecord['facility']['status'];
  };
  assignedAt: Date;
}

export interface TenantStaffScopeListResponse<T> {
  items: T[];
}

@Injectable()
export class TenantStaffScopeService {
  constructor(
    private readonly assignments: TenantStaffScopeRepository,
    private readonly audit: PlatformAuditService,
  ) {}

  async listFacilities(
    context: TrustedTenantContext,
    staffId: string,
  ): Promise<TenantStaffScopeListResponse<TenantStaffFacilityAssignmentResponse>> {
    const tenantId = this.trustedTenantId(context);
    const records = await this.assignments.listFacilitiesForStaff(tenantId, this.staffId(staffId));
    if (!records) throw new TenantStaffScopeNotFoundError();
    return { items: records.map((record) => this.presentFacility(record)) };
  }

  async assignFacility(
    context: TrustedTenantContext,
    staffId: string,
    input: CreateTenantStaffFacilityAssignmentInput,
    actor: AuthenticatedPlatformUser,
    requestContext: TenantStaffScopeAuditContext = {},
  ): Promise<TenantStaffFacilityAssignmentResponse> {
    const tenantId = this.trustedTenantId(context);
    this.assertActor(context, actor);
    const staff = this.staffId(staffId);
    const parsed = createTenantStaffFacilityAssignmentSchema.safeParse(input);
    if (!parsed.success) throw new TenantStaffScopeInputValidationError();

    const result = await this.assignments.assignFacility({
      tenantId,
      actorMembershipId: context.membershipId,
      actorPlatformUserId: actor.userId,
      staffId: staff,
      facilityId: parsed.data.facilityId,
    });
    if (result.kind === 'not-found') throw new TenantStaffScopeNotFoundError();
    if (result.kind === 'actor-ineligible') throw new TenantContextInvalidError();
    if (result.kind === 'staff-ineligible' || result.kind === 'unit-ineligible') {
      throw new TenantStaffScopeConflictError();
    }

    if (result.kind === 'changed') {
      await this.audit.recordAudit({
        eventType: PlatformAuditEventType.STAFF_FACILITY_ASSIGNED,
        actorUserId: actor.userId,
        subjectUserId: result.assignment.staff.userId,
        subjectTenantId: tenantId,
        sessionId: actor.sessionId,
        ...requestContext,
        metadata: {
          staffId: result.assignment.staffId,
          facilityId: result.assignment.facilityId,
          result: 'assigned',
        },
      });
    }
    return this.presentFacility(result.assignment);
  }

  async removeFacility(
    context: TrustedTenantContext,
    staffId: string,
    facilityId: string,
    actor: AuthenticatedPlatformUser,
    requestContext: TenantStaffScopeAuditContext = {},
  ): Promise<void> {
    const tenantId = this.trustedTenantId(context);
    this.assertActor(context, actor);
    const staff = this.staffId(staffId);
    const facility = this.facilityId(facilityId);
    const result = await this.assignments.removeFacility({
      tenantId,
      actorMembershipId: context.membershipId,
      actorPlatformUserId: actor.userId,
      staffId: staff,
      facilityId: facility,
    });
    if (result.kind === 'not-found' || result.kind === 'not-assigned') {
      throw new TenantStaffScopeNotFoundError();
    }
    if (result.kind === 'actor-ineligible') throw new TenantContextInvalidError();

    await this.audit.recordAudit({
      eventType: PlatformAuditEventType.STAFF_FACILITY_UNASSIGNED,
      actorUserId: actor.userId,
      subjectUserId: result.userId,
      subjectTenantId: tenantId,
      sessionId: actor.sessionId,
      ...requestContext,
      metadata: { staffId: staff, facilityId: facility, result: 'removed' },
    });
  }

  async listBranches(
    context: TrustedTenantContext,
    staffId: string,
  ): Promise<TenantStaffScopeListResponse<TenantStaffBranchAssignmentResponse>> {
    const tenantId = this.trustedTenantId(context);
    const records = await this.assignments.listBranchesForStaff(tenantId, this.staffId(staffId));
    if (!records) throw new TenantStaffScopeNotFoundError();
    return { items: records.map((record) => this.presentBranch(record)) };
  }

  async assignBranch(
    context: TrustedTenantContext,
    staffId: string,
    input: CreateTenantStaffBranchAssignmentInput,
    actor: AuthenticatedPlatformUser,
    requestContext: TenantStaffScopeAuditContext = {},
  ): Promise<TenantStaffBranchAssignmentResponse> {
    const tenantId = this.trustedTenantId(context);
    this.assertActor(context, actor);
    const staff = this.staffId(staffId);
    const parsed = createTenantStaffBranchAssignmentSchema.safeParse(input);
    if (!parsed.success) throw new TenantStaffScopeInputValidationError();

    const result = await this.assignments.assignBranch({
      tenantId,
      actorMembershipId: context.membershipId,
      actorPlatformUserId: actor.userId,
      staffId: staff,
      branchId: parsed.data.branchId,
    });
    if (result.kind === 'not-found') throw new TenantStaffScopeNotFoundError();
    if (result.kind === 'actor-ineligible') throw new TenantContextInvalidError();
    if (result.kind === 'staff-ineligible' || result.kind === 'unit-ineligible') {
      throw new TenantStaffScopeConflictError();
    }

    if (result.kind === 'changed') {
      await this.audit.recordAudit({
        eventType: PlatformAuditEventType.STAFF_BRANCH_ASSIGNED,
        actorUserId: actor.userId,
        subjectUserId: result.assignment.staff.userId,
        subjectTenantId: tenantId,
        sessionId: actor.sessionId,
        ...requestContext,
        metadata: {
          staffId: result.assignment.staffId,
          branchId: result.assignment.branchId,
          facilityId: result.assignment.facilityId,
          result: 'assigned',
        },
      });
    }
    return this.presentBranch(result.assignment);
  }

  async removeBranch(
    context: TrustedTenantContext,
    staffId: string,
    branchId: string,
    actor: AuthenticatedPlatformUser,
    requestContext: TenantStaffScopeAuditContext = {},
  ): Promise<void> {
    const tenantId = this.trustedTenantId(context);
    this.assertActor(context, actor);
    const staff = this.staffId(staffId);
    const branch = this.branchId(branchId);
    const result = await this.assignments.removeBranch({
      tenantId,
      actorMembershipId: context.membershipId,
      actorPlatformUserId: actor.userId,
      staffId: staff,
      branchId: branch,
    });
    if (result.kind === 'not-found' || result.kind === 'not-assigned') {
      throw new TenantStaffScopeNotFoundError();
    }
    if (result.kind === 'actor-ineligible') throw new TenantContextInvalidError();

    await this.audit.recordAudit({
      eventType: PlatformAuditEventType.STAFF_BRANCH_UNASSIGNED,
      actorUserId: actor.userId,
      subjectUserId: result.userId,
      subjectTenantId: tenantId,
      sessionId: actor.sessionId,
      ...requestContext,
      metadata: { staffId: staff, branchId: branch, result: 'removed' },
    });
  }

  async resolveEffectiveScope(
    context: TrustedTenantContext,
    staffId: string,
  ): Promise<TenantStaffEffectiveScope | null> {
    return this.assignments.resolveEffectiveScope(
      this.trustedTenantId(context),
      this.staffId(staffId),
    );
  }

  async resolveMembershipScope(
    context: TrustedTenantContext,
  ): Promise<TenantStaffEffectiveScope | null> {
    const tenantId = this.trustedTenantId(context);
    return this.assignments.resolveMembershipScope(
      tenantId,
      context.membershipId.toLowerCase(),
      context.platformUserId.toLowerCase(),
    );
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

  private staffId(value: string): string {
    const parsed = tenantStaffIdSchema.safeParse(value);
    if (!parsed.success) throw new TenantStaffScopeInputValidationError();
    return parsed.data.toLowerCase();
  }

  private facilityId(value: string): string {
    const parsed = tenantStaffScopeFacilityIdSchema.safeParse(value);
    if (!parsed.success) throw new TenantStaffScopeInputValidationError();
    return parsed.data;
  }

  private branchId(value: string): string {
    const parsed = tenantStaffScopeBranchIdSchema.safeParse(value);
    if (!parsed.success) throw new TenantStaffScopeInputValidationError();
    return parsed.data;
  }

  private presentFacility(
    record: TenantStaffFacilityAssignmentRecord,
  ): TenantStaffFacilityAssignmentResponse {
    return {
      staffId: record.staffId,
      facilityId: record.facilityId,
      facilityName: record.facility.name,
      facilityStatus: record.facility.status,
      assignedAt: record.assignedAt,
    };
  }

  private presentBranch(
    record: TenantStaffBranchAssignmentRecord,
  ): TenantStaffBranchAssignmentResponse {
    return {
      staffId: record.staffId,
      branchId: record.branchId,
      branchName: record.branch.name,
      branchStatus: record.branch.status,
      facility: {
        id: record.facility.id,
        name: record.facility.name,
        status: record.facility.status,
      },
      assignedAt: record.assignedAt,
    };
  }
}
