import { Inject, Injectable } from '@nestjs/common';
import { FacilityStatus, PlatformAuditEventType } from '../common/domain-enums';
import { z } from 'zod';
import type { AuthenticatedPlatformUser } from '../auth/auth.types';
import { PlatformAuditService } from '../platform-security/platform-audit.service';
import type { TrustedSecurityContext } from '../platform-security/platform-security.types';
import {
  FacilityIdInvalidError,
  FacilityInputValidationError,
  FacilityLifecycleConflictError,
  FacilityNotFoundError,
} from './facility.errors';
import {
  createFacilitySchema,
  facilityIdSchema,
  listFacilitiesQuerySchema,
  updateFacilitySchema,
  type CreateFacilityInput,
  type ListFacilitiesQuery,
  type UpdateFacilityInput,
} from './facility.dto';
import {
  FACILITY_PERSISTENCE,
  type FacilityPersistencePort,
} from '../persistence/platform-persistence.ports';
import type { FacilityRecord } from '../persistence/platform-persistence.ports';
import {
  TenantContextInvalidError,
  TenantContextRequiredError,
  type TrustedTenantContext,
} from './tenant-context.contract';
import { tenantIdSchema } from './tenant.dto';

export type FacilityRequestAuditContext = Pick<
  TrustedSecurityContext,
  'requestId' | 'ipAddress' | 'userAgent'
>;

@Injectable()
export class FacilityService {
  constructor(
    @Inject(FACILITY_PERSISTENCE) private readonly facilities: FacilityPersistencePort,
    private readonly audit: PlatformAuditService,
  ) {}

  async create(
    context: TrustedTenantContext,
    input: CreateFacilityInput,
    actor: AuthenticatedPlatformUser,
    requestContext: FacilityRequestAuditContext = {},
  ): Promise<FacilityRecord> {
    const tenantId = this.tenantId(context);
    this.assertActor(context, actor);
    const parsed = createFacilitySchema.safeParse(input);
    if (!parsed.success) throw new FacilityInputValidationError();

    const facility = await this.facilities.create(tenantId, { name: parsed.data.name });
    await this.audit.recordAudit({
      eventType: PlatformAuditEventType.FACILITY_CREATED,
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      subjectTenantId: tenantId,
      ...requestContext,
      metadata: { facilityId: facility.id, status: facility.status },
    });
    return facility;
  }

  async list(
    context: TrustedTenantContext,
    query: ListFacilitiesQuery,
  ): Promise<{ items: FacilityRecord[]; limit: number; offset: number }> {
    const tenantId = this.tenantId(context);
    const parsed = listFacilitiesQuerySchema.safeParse(query);
    if (!parsed.success) throw new FacilityInputValidationError();
    const { status, limit, offset } = parsed.data;
    const items = await this.facilities.listForTenant(tenantId, { status, limit, offset });
    return { items, limit, offset };
  }

  async findById(context: TrustedTenantContext, id: string): Promise<FacilityRecord> {
    const tenantId = this.tenantId(context);
    const facilityId = this.facilityId(id);
    const facility = await this.facilities.findById(tenantId, facilityId);
    if (!facility) throw new FacilityNotFoundError();
    return facility;
  }

  async update(
    context: TrustedTenantContext,
    id: string,
    input: UpdateFacilityInput,
    actor: AuthenticatedPlatformUser,
    requestContext: FacilityRequestAuditContext = {},
  ): Promise<FacilityRecord> {
    const tenantId = this.tenantId(context);
    this.assertActor(context, actor);
    const facilityId = this.facilityId(id);
    const parsed = updateFacilitySchema.safeParse(input);
    if (!parsed.success || parsed.data.name === undefined) {
      throw new FacilityInputValidationError();
    }

    const facility = await this.facilities.updateName(tenantId, facilityId, parsed.data.name);
    if (!facility) throw new FacilityNotFoundError();

    await this.audit.recordAudit({
      eventType: PlatformAuditEventType.FACILITY_UPDATED,
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      subjectTenantId: tenantId,
      ...requestContext,
      metadata: { facilityId: facility.id, changedFields: 'name' },
    });
    return facility;
  }

  suspend(
    context: TrustedTenantContext,
    id: string,
    actor: AuthenticatedPlatformUser,
    requestContext: FacilityRequestAuditContext = {},
  ): Promise<FacilityRecord> {
    return this.transition(context, id, FacilityStatus.SUSPENDED, actor, requestContext);
  }

  activate(
    context: TrustedTenantContext,
    id: string,
    actor: AuthenticatedPlatformUser,
    requestContext: FacilityRequestAuditContext = {},
  ): Promise<FacilityRecord> {
    return this.transition(context, id, FacilityStatus.ACTIVE, actor, requestContext);
  }

  deactivate(
    context: TrustedTenantContext,
    id: string,
    actor: AuthenticatedPlatformUser,
    requestContext: FacilityRequestAuditContext = {},
  ): Promise<FacilityRecord> {
    return this.transition(context, id, FacilityStatus.DEACTIVATED, actor, requestContext);
  }

  private async transition(
    context: TrustedTenantContext,
    id: string,
    nextStatus: FacilityStatus,
    actor: AuthenticatedPlatformUser,
    requestContext: FacilityRequestAuditContext,
  ): Promise<FacilityRecord> {
    const tenantId = this.tenantId(context);
    this.assertActor(context, actor);
    const facilityId = this.facilityId(id);
    const current = await this.facilities.findById(tenantId, facilityId);
    if (!current) throw new FacilityNotFoundError();
    if (current.status === nextStatus) return current;
    if (!this.canTransition(current.status, nextStatus)) {
      throw new FacilityLifecycleConflictError();
    }

    const changedAt = new Date();
    const updated = await this.facilities.changeStatusIfCurrent(
      tenantId,
      facilityId,
      current.status,
      nextStatus,
      changedAt,
    );
    if (!updated) {
      const latest = await this.facilities.findById(tenantId, facilityId);
      if (!latest) throw new FacilityNotFoundError();
      if (latest.status === nextStatus) return latest;
      throw new FacilityLifecycleConflictError();
    }

    await this.audit.recordAudit({
      eventType: this.statusAuditEvent(nextStatus),
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      subjectTenantId: tenantId,
      ...requestContext,
      metadata: {
        facilityId: updated.id,
        fromStatus: current.status,
        toStatus: updated.status,
      },
    });
    return updated;
  }

  private tenantId(context: TrustedTenantContext): string {
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

  private facilityId(id: string): string {
    const parsed = facilityIdSchema.safeParse(id);
    if (!parsed.success) throw new FacilityIdInvalidError();
    return parsed.data;
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

  private canTransition(current: FacilityStatus, next: FacilityStatus): boolean {
    if (current === FacilityStatus.ACTIVE) {
      return next === FacilityStatus.SUSPENDED || next === FacilityStatus.DEACTIVATED;
    }
    if (current === FacilityStatus.SUSPENDED) {
      return next === FacilityStatus.ACTIVE || next === FacilityStatus.DEACTIVATED;
    }
    return false;
  }

  private statusAuditEvent(status: FacilityStatus): PlatformAuditEventType {
    if (status === FacilityStatus.SUSPENDED) return PlatformAuditEventType.FACILITY_SUSPENDED;
    if (status === FacilityStatus.ACTIVE) return PlatformAuditEventType.FACILITY_ACTIVATED;
    return PlatformAuditEventType.FACILITY_DEACTIVATED;
  }
}
