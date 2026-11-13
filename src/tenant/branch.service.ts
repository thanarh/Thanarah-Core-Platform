import { Inject, Injectable } from '@nestjs/common';
import {
  BranchStatus,
  FacilityStatus,
  PlatformAuditEventType,
  TenantStatus,
} from '../common/domain-enums';
import { z } from 'zod';
import type { AuthenticatedPlatformUser } from '../auth/auth.types';
import { PlatformAuditService } from '../platform-security/platform-audit.service';
import type { TrustedSecurityContext } from '../platform-security/platform-security.types';
import {
  BranchFacilityIdInvalidError,
  BranchFacilityNotFoundError,
  BranchIdInvalidError,
  BranchInputValidationError,
  BranchLifecycleConflictError,
  BranchNotFoundError,
  BranchParentUnavailableError,
} from './branch.errors';
import {
  branchFacilityIdSchema,
  branchIdSchema,
  createBranchSchema,
  listBranchesQuerySchema,
  updateBranchSchema,
  type CreateBranchInput,
  type ListBranchesQuery,
  type UpdateBranchInput,
} from './branch.dto';
import {
  BRANCH_PERSISTENCE,
  type BranchPersistencePort,
} from '../persistence/platform-persistence.ports';
import type { BranchRecord } from '../persistence/platform-persistence.ports';
import {
  TenantContextInvalidError,
  TenantContextRequiredError,
  type TrustedTenantContext,
} from './tenant-context.contract';
import { tenantIdSchema } from './tenant.dto';

export type BranchRequestAuditContext = Pick<
  TrustedSecurityContext,
  'requestId' | 'ipAddress' | 'userAgent'
>;

@Injectable()
export class BranchService {
  constructor(
    @Inject(BRANCH_PERSISTENCE) private readonly branches: BranchPersistencePort,
    private readonly audit: PlatformAuditService,
  ) {}

  async create(
    context: TrustedTenantContext,
    facilityId: string,
    input: CreateBranchInput,
    actor: AuthenticatedPlatformUser,
    requestContext: BranchRequestAuditContext = {},
  ): Promise<BranchRecord> {
    const tenantId = this.tenantId(context);
    this.assertActor(context, actor);
    const scopedFacilityId = this.facilityId(facilityId);
    await this.assertActiveFacility(tenantId, scopedFacilityId);

    const parsed = createBranchSchema.safeParse(input);
    if (!parsed.success) throw new BranchInputValidationError();

    const branch = await this.branches.createUnderActiveFacility(tenantId, scopedFacilityId, {
      name: parsed.data.name,
    });
    if (!branch) {
      await this.assertActiveFacility(tenantId, scopedFacilityId);
      throw new BranchParentUnavailableError();
    }

    await this.audit.recordAudit({
      eventType: PlatformAuditEventType.BRANCH_CREATED,
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      subjectTenantId: tenantId,
      ...requestContext,
      metadata: {
        facilityId: scopedFacilityId,
        branchId: branch.id,
        status: branch.status,
      },
    });
    return branch;
  }

  async list(
    context: TrustedTenantContext,
    facilityId: string,
    query: ListBranchesQuery,
  ): Promise<{ items: BranchRecord[]; limit: number; offset: number }> {
    const tenantId = this.tenantId(context);
    const scopedFacilityId = this.facilityId(facilityId);
    await this.assertActiveFacility(tenantId, scopedFacilityId);

    const parsed = listBranchesQuerySchema.safeParse(query);
    if (!parsed.success) throw new BranchInputValidationError();
    const { status, limit, offset } = parsed.data;
    const items = await this.branches.listForFacility(tenantId, scopedFacilityId, {
      status,
      limit,
      offset,
    });
    return { items, limit, offset };
  }

  async findById(
    context: TrustedTenantContext,
    facilityId: string,
    branchId: string,
  ): Promise<BranchRecord> {
    const tenantId = this.tenantId(context);
    const scopedFacilityId = this.facilityId(facilityId);
    const scopedBranchId = this.branchId(branchId);
    await this.assertActiveFacility(tenantId, scopedFacilityId);

    const branch = await this.branches.findByIdWithinFacility(
      tenantId,
      scopedFacilityId,
      scopedBranchId,
    );
    if (!branch) throw new BranchNotFoundError();
    return branch;
  }

  async update(
    context: TrustedTenantContext,
    facilityId: string,
    branchId: string,
    input: UpdateBranchInput,
    actor: AuthenticatedPlatformUser,
    requestContext: BranchRequestAuditContext = {},
  ): Promise<BranchRecord> {
    const tenantId = this.tenantId(context);
    this.assertActor(context, actor);
    const scopedFacilityId = this.facilityId(facilityId);
    const scopedBranchId = this.branchId(branchId);
    await this.assertActiveFacility(tenantId, scopedFacilityId);

    const parsed = updateBranchSchema.safeParse(input);
    if (!parsed.success || parsed.data.name === undefined) {
      throw new BranchInputValidationError();
    }

    const branch = await this.branches.updateNameWithinFacility(
      tenantId,
      scopedFacilityId,
      scopedBranchId,
      parsed.data.name,
    );
    if (!branch) {
      await this.assertActiveFacility(tenantId, scopedFacilityId);
      throw new BranchNotFoundError();
    }

    await this.audit.recordAudit({
      eventType: PlatformAuditEventType.BRANCH_UPDATED,
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      subjectTenantId: tenantId,
      ...requestContext,
      metadata: {
        facilityId: scopedFacilityId,
        branchId: branch.id,
        changedFields: 'name',
      },
    });
    return branch;
  }

  suspend(
    context: TrustedTenantContext,
    facilityId: string,
    branchId: string,
    actor: AuthenticatedPlatformUser,
    requestContext: BranchRequestAuditContext = {},
  ): Promise<BranchRecord> {
    return this.transition(
      context,
      facilityId,
      branchId,
      BranchStatus.SUSPENDED,
      actor,
      requestContext,
    );
  }

  activate(
    context: TrustedTenantContext,
    facilityId: string,
    branchId: string,
    actor: AuthenticatedPlatformUser,
    requestContext: BranchRequestAuditContext = {},
  ): Promise<BranchRecord> {
    return this.transition(
      context,
      facilityId,
      branchId,
      BranchStatus.ACTIVE,
      actor,
      requestContext,
    );
  }

  deactivate(
    context: TrustedTenantContext,
    facilityId: string,
    branchId: string,
    actor: AuthenticatedPlatformUser,
    requestContext: BranchRequestAuditContext = {},
  ): Promise<BranchRecord> {
    return this.transition(
      context,
      facilityId,
      branchId,
      BranchStatus.DEACTIVATED,
      actor,
      requestContext,
    );
  }

  private async transition(
    context: TrustedTenantContext,
    facilityId: string,
    branchId: string,
    nextStatus: BranchStatus,
    actor: AuthenticatedPlatformUser,
    requestContext: BranchRequestAuditContext,
  ): Promise<BranchRecord> {
    const tenantId = this.tenantId(context);
    this.assertActor(context, actor);
    const scopedFacilityId = this.facilityId(facilityId);
    const scopedBranchId = this.branchId(branchId);
    await this.assertActiveFacility(tenantId, scopedFacilityId);

    const current = await this.branches.findByIdWithinFacility(
      tenantId,
      scopedFacilityId,
      scopedBranchId,
    );
    if (!current) throw new BranchNotFoundError();
    if (current.status === nextStatus) return current;
    if (!this.canTransition(current.status, nextStatus)) {
      throw new BranchLifecycleConflictError();
    }

    const changedAt = new Date();
    const updated = await this.branches.changeStatusIfCurrentWithinFacility(
      tenantId,
      scopedFacilityId,
      scopedBranchId,
      current.status,
      nextStatus,
      changedAt,
    );
    if (!updated) {
      await this.assertActiveFacility(tenantId, scopedFacilityId);
      const latest = await this.branches.findByIdWithinFacility(
        tenantId,
        scopedFacilityId,
        scopedBranchId,
      );
      if (!latest) throw new BranchNotFoundError();
      if (latest.status === nextStatus) return latest;
      throw new BranchLifecycleConflictError();
    }

    await this.audit.recordAudit({
      eventType: this.statusAuditEvent(nextStatus),
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      subjectTenantId: tenantId,
      ...requestContext,
      metadata: {
        facilityId: scopedFacilityId,
        branchId: updated.id,
        fromStatus: current.status,
        toStatus: updated.status,
      },
    });
    return updated;
  }

  private async assertActiveFacility(tenantId: string, facilityId: string): Promise<void> {
    const facility = await this.branches.findFacilityScope(tenantId, facilityId);
    if (!facility) throw new BranchFacilityNotFoundError();
    if (facility.tenant.status !== TenantStatus.ACTIVE) throw new TenantContextInvalidError();
    if (facility.status !== FacilityStatus.ACTIVE) throw new BranchParentUnavailableError();
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
    const parsed = branchFacilityIdSchema.safeParse(id);
    if (!parsed.success) throw new BranchFacilityIdInvalidError();
    return parsed.data;
  }

  private branchId(id: string): string {
    const parsed = branchIdSchema.safeParse(id);
    if (!parsed.success) throw new BranchIdInvalidError();
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

  private canTransition(current: BranchStatus, next: BranchStatus): boolean {
    if (current === BranchStatus.ACTIVE) {
      return next === BranchStatus.SUSPENDED || next === BranchStatus.DEACTIVATED;
    }
    if (current === BranchStatus.SUSPENDED) {
      return next === BranchStatus.ACTIVE || next === BranchStatus.DEACTIVATED;
    }
    return false;
  }

  private statusAuditEvent(status: BranchStatus): PlatformAuditEventType {
    if (status === BranchStatus.SUSPENDED) return PlatformAuditEventType.BRANCH_SUSPENDED;
    if (status === BranchStatus.ACTIVE) return PlatformAuditEventType.BRANCH_ACTIVATED;
    return PlatformAuditEventType.BRANCH_DEACTIVATED;
  }
}
