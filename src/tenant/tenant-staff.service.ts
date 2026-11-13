import { Inject, Injectable } from '@nestjs/common';
import { PlatformAuditEventType, StaffStatus } from '../common/domain-enums';
import { z } from 'zod';
import type { AuthenticatedPlatformUser } from '../auth/auth.types';
import { PlatformAuditService } from '../platform-security/platform-audit.service';
import type { TrustedSecurityContext } from '../platform-security/platform-security.types';
import { TenantContextInvalidError, TenantContextRequiredError } from './tenant-context.contract';
import type { TrustedTenantContext } from './tenant-context.contract';
import { tenantIdSchema } from './tenant.dto';
import {
  createTenantStaffSchema,
  listTenantStaffQuerySchema,
  tenantStaffIdSchema,
  updateTenantStaffSchema,
  type CreateTenantStaffInput,
  type ListTenantStaffQuery,
  type UpdateTenantStaffInput,
} from './tenant-staff.dto';
import {
  TenantStaffAlreadyExistsError,
  TenantStaffIdInvalidError,
  TenantStaffInputValidationError,
  TenantStaffLifecycleConflictError,
  TenantStaffMembershipNotEligibleError,
  TenantStaffNotFoundError,
  TenantStaffTenantUnavailableError,
} from './tenant-staff.errors';
import {
  TENANT_STAFF_PERSISTENCE,
  type TenantStaffPersistencePort,
  type TenantStaffRecord,
} from '../persistence/platform-persistence.ports';

export type TenantStaffAuditContext = Pick<
  TrustedSecurityContext,
  'requestId' | 'ipAddress' | 'userAgent'
>;

export interface TenantStaffResponse {
  id: string;
  membershipId: string;
  displayName: string;
  jobTitle: string | null;
  status: StaffStatus;
  statusChangedAt: Date;
  suspendedAt: Date | null;
  deactivatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantStaffListResponse {
  items: TenantStaffResponse[];
  limit: number;
  offset: number;
}

@Injectable()
export class TenantStaffService {
  constructor(
    @Inject(TENANT_STAFF_PERSISTENCE) private readonly staff: TenantStaffPersistencePort,
    private readonly audit: PlatformAuditService,
  ) {}

  async create(
    context: TrustedTenantContext,
    input: CreateTenantStaffInput,
    actor: AuthenticatedPlatformUser,
    requestContext: TenantStaffAuditContext = {},
  ): Promise<TenantStaffResponse> {
    const tenantId = this.trustedTenantId(context);
    this.assertActor(context, actor);
    const parsed = createTenantStaffSchema.safeParse(input);
    if (!parsed.success) throw new TenantStaffInputValidationError();

    const result = await this.staff.createForActiveMembership(tenantId, parsed.data.membershipId, {
      ...(parsed.data.displayName !== undefined ? { displayName: parsed.data.displayName } : {}),
      ...(parsed.data.jobTitle !== undefined ? { jobTitle: parsed.data.jobTitle } : {}),
    });
    if (result.kind === 'membership-ineligible') {
      throw new TenantStaffMembershipNotEligibleError();
    }
    if (result.kind === 'tenant-unavailable') throw new TenantStaffTenantUnavailableError();
    if (result.kind === 'already-exists') throw new TenantStaffAlreadyExistsError();

    await this.audit.recordAudit({
      eventType: PlatformAuditEventType.STAFF_CREATED,
      actorUserId: actor.userId,
      subjectUserId: result.staff.userId,
      subjectTenantId: tenantId,
      sessionId: actor.sessionId,
      ...requestContext,
      metadata: {
        staffId: result.staff.id,
        membershipId: result.staff.membershipId,
        status: result.staff.status,
      },
    });
    return this.present(result.staff);
  }

  async list(
    context: TrustedTenantContext,
    query: ListTenantStaffQuery,
  ): Promise<TenantStaffListResponse> {
    const tenantId = this.trustedTenantId(context);
    const parsed = listTenantStaffQuerySchema.safeParse(query);
    if (!parsed.success) throw new TenantStaffInputValidationError();
    const { status, limit, offset } = parsed.data;
    const items = await this.staff.listForTenant(tenantId, { status, limit, offset });
    return { items: items.map((record) => this.present(record)), limit, offset };
  }

  async findById(context: TrustedTenantContext, staffId: string): Promise<TenantStaffResponse> {
    const tenantId = this.trustedTenantId(context);
    const id = this.staffId(staffId);
    const staff = await this.staff.findByIdForTenant(tenantId, id);
    if (!staff) throw new TenantStaffNotFoundError();
    return this.present(staff);
  }

  async update(
    context: TrustedTenantContext,
    staffId: string,
    input: UpdateTenantStaffInput,
    actor: AuthenticatedPlatformUser,
    requestContext: TenantStaffAuditContext = {},
  ): Promise<TenantStaffResponse> {
    const tenantId = this.trustedTenantId(context);
    this.assertActor(context, actor);
    const id = this.staffId(staffId);
    const parsed = updateTenantStaffSchema.safeParse(input);
    if (!parsed.success) throw new TenantStaffInputValidationError();

    const updated = await this.staff.updateForTenant(tenantId, id, parsed.data);
    if (!updated) throw new TenantStaffNotFoundError();

    await this.audit.recordAudit({
      eventType: PlatformAuditEventType.STAFF_UPDATED,
      actorUserId: actor.userId,
      subjectUserId: updated.userId,
      subjectTenantId: tenantId,
      sessionId: actor.sessionId,
      ...requestContext,
      metadata: {
        staffId: updated.id,
        membershipId: updated.membershipId,
        changedFields: Object.keys(parsed.data).join(','),
      },
    });
    return this.present(updated);
  }

  suspend(
    context: TrustedTenantContext,
    staffId: string,
    actor: AuthenticatedPlatformUser,
    requestContext: TenantStaffAuditContext = {},
  ): Promise<TenantStaffResponse> {
    return this.transition(context, staffId, StaffStatus.SUSPENDED, actor, requestContext);
  }

  activate(
    context: TrustedTenantContext,
    staffId: string,
    actor: AuthenticatedPlatformUser,
    requestContext: TenantStaffAuditContext = {},
  ): Promise<TenantStaffResponse> {
    return this.transition(context, staffId, StaffStatus.ACTIVE, actor, requestContext);
  }

  deactivate(
    context: TrustedTenantContext,
    staffId: string,
    actor: AuthenticatedPlatformUser,
    requestContext: TenantStaffAuditContext = {},
  ): Promise<TenantStaffResponse> {
    return this.transition(context, staffId, StaffStatus.DEACTIVATED, actor, requestContext);
  }

  private async transition(
    context: TrustedTenantContext,
    staffId: string,
    nextStatus: StaffStatus,
    actor: AuthenticatedPlatformUser,
    requestContext: TenantStaffAuditContext,
  ): Promise<TenantStaffResponse> {
    const tenantId = this.trustedTenantId(context);
    this.assertActor(context, actor);
    const id = this.staffId(staffId);
    const current = await this.staff.findByIdForTenant(tenantId, id);
    if (!current) throw new TenantStaffNotFoundError();
    if (current.status === nextStatus) return this.present(current);
    if (!this.canTransition(current.status, nextStatus)) {
      throw new TenantStaffLifecycleConflictError();
    }

    const changedAt = new Date();
    const updated = await this.staff.changeStatusIfCurrentForTenant(
      tenantId,
      id,
      current.status,
      nextStatus,
      changedAt,
    );
    if (!updated) {
      const latest = await this.staff.findByIdForTenant(tenantId, id);
      if (!latest) throw new TenantStaffNotFoundError();
      if (latest.status === nextStatus) return this.present(latest);
      throw new TenantStaffLifecycleConflictError();
    }

    await this.audit.recordAudit({
      eventType: this.statusAuditEvent(nextStatus),
      actorUserId: actor.userId,
      subjectUserId: updated.userId,
      subjectTenantId: tenantId,
      sessionId: actor.sessionId,
      ...requestContext,
      metadata: {
        staffId: updated.id,
        membershipId: updated.membershipId,
        fromStatus: current.status,
        toStatus: updated.status,
      },
    });
    return this.present(updated);
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
    if (!parsed.success) throw new TenantStaffIdInvalidError();
    return parsed.data;
  }

  private canTransition(current: StaffStatus, next: StaffStatus): boolean {
    if (current === StaffStatus.ACTIVE) {
      return next === StaffStatus.SUSPENDED || next === StaffStatus.DEACTIVATED;
    }
    if (current === StaffStatus.SUSPENDED) {
      return next === StaffStatus.ACTIVE || next === StaffStatus.DEACTIVATED;
    }
    return false;
  }

  private statusAuditEvent(status: StaffStatus): PlatformAuditEventType {
    if (status === StaffStatus.SUSPENDED) return PlatformAuditEventType.STAFF_SUSPENDED;
    if (status === StaffStatus.ACTIVE) return PlatformAuditEventType.STAFF_ACTIVATED;
    return PlatformAuditEventType.STAFF_DEACTIVATED;
  }

  private present(record: TenantStaffRecord): TenantStaffResponse {
    return {
      id: record.id,
      membershipId: record.membershipId,
      displayName: record.displayName,
      jobTitle: record.jobTitle,
      status: record.status,
      statusChangedAt: record.statusChangedAt,
      suspendedAt: record.suspendedAt,
      deactivatedAt: record.deactivatedAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
