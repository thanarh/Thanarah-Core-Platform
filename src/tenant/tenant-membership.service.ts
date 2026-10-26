import { Injectable } from '@nestjs/common';
import { PlatformAuditEventType, Prisma, TenantMembershipStatus } from '@prisma/client';
import { z } from 'zod';
import type { AuthenticatedPlatformUser } from '../auth/auth.types';
import { PlatformUserRepository } from '../auth/repositories/platform-user.repository';
import { tenantIdSchema } from './tenant.dto';
import {
  createTenantMembershipSchema,
  listTenantMembershipsQuerySchema,
  tenantMembershipIdSchema,
  type CreateTenantMembershipInput,
  type ListTenantMembershipsQuery,
} from './tenant-membership.dto';
import {
  TenantMembershipExistsError,
  TenantMembershipInputValidationError,
  TenantMembershipLifecycleConflictError,
  TenantMembershipNotFoundError,
  TenantMembershipPlatformUserNotFoundError,
  TenantMembershipSelfManagementError,
} from './tenant-membership.errors';
import { TenantOwnerProtectionError } from './tenant-authorization.errors';
import type {
  TenantMembershipAccessLookup,
  TenantMembershipAccessQuery,
} from './tenant-membership-access.contract';
import {
  TenantMembershipRepository,
  type TenantMembershipRecord,
} from './tenant-membership.repository';
import { TenantRepository } from './tenant.repository';
import { TenantNotFoundError } from './tenant.errors';
import { PlatformAuditService } from '../platform-security/platform-audit.service';
import type { TrustedSecurityContext } from '../platform-security/platform-security.types';
import type { TrustedTenantContext } from './tenant-context.contract';

export type TenantMembershipAuditContext = Pick<
  TrustedSecurityContext,
  'requestId' | 'ipAddress' | 'userAgent'
>;

const membershipAccessQuerySchema = z
  .object({
    tenantId: z.string().uuid(),
    platformUserId: z.string().uuid(),
  })
  .strict();

@Injectable()
export class TenantMembershipService implements TenantMembershipAccessLookup {
  constructor(
    private readonly memberships: TenantMembershipRepository,
    private readonly tenants: TenantRepository,
    private readonly platformUsers: PlatformUserRepository,
    private readonly audit: PlatformAuditService,
  ) {}

  async invite(
    tenantId: string,
    input: CreateTenantMembershipInput,
    actor: AuthenticatedPlatformUser,
    requestContext: TenantMembershipAuditContext = {},
  ): Promise<TenantMembershipRecord> {
    this.assertTenantId(tenantId);
    const parsed = createTenantMembershipSchema.safeParse(input);
    if (!parsed.success) throw new TenantMembershipInputValidationError();

    const platformUserId = parsed.data.platformUserId;
    this.assertNotSelfManagement(actor, platformUserId);

    if (!(await this.tenants.findById(tenantId))) throw new TenantNotFoundError();
    if (!(await this.platformUsers.findAuthRecordById(platformUserId))) {
      throw new TenantMembershipPlatformUserNotFoundError();
    }
    if (await this.memberships.findByTenantAndPlatformUser(tenantId, platformUserId)) {
      throw new TenantMembershipExistsError();
    }

    let membership: TenantMembershipRecord;
    try {
      membership = await this.memberships.create({ tenantId, platformUserId });
    } catch (error) {
      if (this.isMembershipUniqueConflict(error)) throw new TenantMembershipExistsError();
      throw error;
    }

    await this.audit.recordAudit({
      eventType: PlatformAuditEventType.TENANT_MEMBERSHIP_INVITED,
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      subjectUserId: membership.platformUserId,
      subjectTenantId: membership.tenantId,
      ...requestContext,
      metadata: { membershipId: membership.id, status: membership.status },
    });

    return membership;
  }

  async listForTenant(
    tenantId: string,
    query: ListTenantMembershipsQuery,
  ): Promise<{ items: TenantMembershipRecord[]; limit: number; offset: number }> {
    this.assertTenantId(tenantId);
    const parsed = listTenantMembershipsQuerySchema.safeParse(query);
    if (!parsed.success) throw new TenantMembershipInputValidationError();
    if (!(await this.tenants.findById(tenantId))) throw new TenantNotFoundError();

    const { status, limit, offset } = parsed.data;
    const items = await this.memberships.listForTenant({ tenantId, status, limit, offset });
    return { items, limit, offset };
  }

  async listDirectoryForTrustedTenant(
    context: TrustedTenantContext,
    query: ListTenantMembershipsQuery,
  ): Promise<{
    items: Array<{
      id: string;
      platformUserId: string;
      status: TenantMembershipRecord['status'];
      statusChangedAt: Date;
      createdAt: Date;
      memberName: string;
      accountStatus: string;
    }>;
    limit: number;
    offset: number;
  }> {
    if (
      !context ||
      typeof context.tenantId !== 'string' ||
      !z.string().uuid().safeParse(context.tenantId).success
    ) {
      throw new TenantMembershipInputValidationError();
    }
    const parsed = listTenantMembershipsQuerySchema.safeParse(query);
    if (!parsed.success) throw new TenantMembershipInputValidationError();
    const { status, limit, offset } = parsed.data;
    const items = await this.memberships.listDirectoryForTenant({
      tenantId: context.tenantId,
      status,
      limit,
      offset,
    });
    return {
      items: items.map((membership) => ({
        id: membership.id,
        platformUserId: membership.platformUserId,
        status: membership.status,
        statusChangedAt: membership.statusChangedAt,
        createdAt: membership.createdAt,
        memberName: membership.platformUser.fullName,
        accountStatus: membership.platformUser.status,
      })),
      limit,
      offset,
    };
  }

  async activate(
    tenantId: string,
    membershipId: string,
    actor: AuthenticatedPlatformUser,
    requestContext: TenantMembershipAuditContext = {},
  ): Promise<TenantMembershipRecord> {
    return this.changeStatus(
      tenantId,
      membershipId,
      TenantMembershipStatus.ACTIVE,
      actor,
      requestContext,
    );
  }

  async suspend(
    tenantId: string,
    membershipId: string,
    actor: AuthenticatedPlatformUser,
    requestContext: TenantMembershipAuditContext = {},
  ): Promise<TenantMembershipRecord> {
    return this.changeStatus(
      tenantId,
      membershipId,
      TenantMembershipStatus.SUSPENDED,
      actor,
      requestContext,
    );
  }

  async remove(
    tenantId: string,
    membershipId: string,
    actor: AuthenticatedPlatformUser,
    requestContext: TenantMembershipAuditContext = {},
  ): Promise<TenantMembershipRecord> {
    return this.changeStatus(
      tenantId,
      membershipId,
      TenantMembershipStatus.REMOVED,
      actor,
      requestContext,
    );
  }

  /** Relationship-state check only; this does not authorize tenant operations. */
  async hasActiveMembership(query: TenantMembershipAccessQuery): Promise<boolean> {
    const parsed = membershipAccessQuerySchema.safeParse(query);
    if (!parsed.success) throw new TenantMembershipInputValidationError();
    return this.memberships.hasActiveMembership(parsed.data.tenantId, parsed.data.platformUserId);
  }

  private async changeStatus(
    tenantId: string,
    membershipId: string,
    nextStatus: TenantMembershipStatus,
    actor: AuthenticatedPlatformUser,
    requestContext: TenantMembershipAuditContext,
  ): Promise<TenantMembershipRecord> {
    this.assertTenantId(tenantId);
    if (!tenantMembershipIdSchema.safeParse(membershipId).success) {
      throw new TenantMembershipInputValidationError();
    }

    const current = await this.memberships.findByIdForTenant(membershipId, tenantId);
    if (!current) throw new TenantMembershipNotFoundError();
    this.assertNotSelfManagement(actor, current.platformUserId);

    if (current.status === nextStatus) return current;
    if (!this.canTransition(current.status, nextStatus)) {
      throw new TenantMembershipLifecycleConflictError();
    }

    const changedAt = new Date();
    const change = await this.memberships.changeStatusIfCurrent(
      membershipId,
      tenantId,
      current.status,
      nextStatus,
      changedAt,
    );

    if (change.kind === 'owner-protected') throw new TenantOwnerProtectionError();

    if (change.kind === 'stale') {
      const latest = await this.memberships.findByIdForTenant(membershipId, tenantId);
      if (!latest) throw new TenantMembershipNotFoundError();
      if (latest.status === nextStatus) return latest;
      throw new TenantMembershipLifecycleConflictError();
    }
    const updated = change.membership;

    await this.audit.recordAudit({
      eventType: this.eventForStatus(nextStatus),
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      subjectUserId: updated.platformUserId,
      subjectTenantId: updated.tenantId,
      ...requestContext,
      metadata: {
        membershipId: updated.id,
        fromStatus: current.status,
        toStatus: updated.status,
      },
    });

    return updated;
  }

  private assertTenantId(tenantId: string): void {
    if (!tenantIdSchema.safeParse(tenantId).success) {
      throw new TenantMembershipInputValidationError();
    }
  }

  private assertNotSelfManagement(actor: AuthenticatedPlatformUser, platformUserId: string): void {
    if (actor.userId.toLowerCase() === platformUserId.toLowerCase()) {
      throw new TenantMembershipSelfManagementError();
    }
  }

  private canTransition(current: TenantMembershipStatus, next: TenantMembershipStatus): boolean {
    if (current === TenantMembershipStatus.INVITED) {
      return next === TenantMembershipStatus.ACTIVE || next === TenantMembershipStatus.REMOVED;
    }
    if (current === TenantMembershipStatus.ACTIVE) {
      return next === TenantMembershipStatus.SUSPENDED || next === TenantMembershipStatus.REMOVED;
    }
    if (current === TenantMembershipStatus.SUSPENDED) {
      return next === TenantMembershipStatus.ACTIVE || next === TenantMembershipStatus.REMOVED;
    }
    return false;
  }

  private eventForStatus(nextStatus: TenantMembershipStatus): PlatformAuditEventType {
    if (nextStatus === TenantMembershipStatus.ACTIVE) {
      return PlatformAuditEventType.TENANT_MEMBERSHIP_ACTIVATED;
    }
    if (nextStatus === TenantMembershipStatus.SUSPENDED) {
      return PlatformAuditEventType.TENANT_MEMBERSHIP_SUSPENDED;
    }
    if (nextStatus === TenantMembershipStatus.REMOVED) {
      return PlatformAuditEventType.TENANT_MEMBERSHIP_REMOVED;
    }
    throw new TenantMembershipLifecycleConflictError();
  }

  private isMembershipUniqueConflict(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      return false;
    }

    const target = error.meta?.target;
    const targets = Array.isArray(target) ? target : [target];
    const targetDescription = targets.filter((value) => typeof value === 'string').join(' ');
    return /tenantId/i.test(targetDescription) && /platformUserId/i.test(targetDescription);
  }
}
