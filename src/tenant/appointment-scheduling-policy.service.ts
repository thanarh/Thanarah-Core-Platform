import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  FacilitySchedulingPolicyRevisionAction,
  FacilitySchedulingPolicyStatus,
  PlatformAuditEventType,
} from '@prisma/client';
import { z } from 'zod';
import type { AuthenticatedPlatformUser } from '../auth/auth.types';
import { PlatformAuditService } from '../platform-security/platform-audit.service';
import type { TrustedSecurityContext } from '../platform-security/platform-security.types';
import type { TrustedTenantContext } from './tenant-context.contract';
import {
  TenantContextInvalidError,
  isWellFormedTrustedTenantContext,
} from './tenant-context.contract';
import { tenantIdSchema } from './tenant.dto';
import { FacilityService } from './facility.service';
import { DoctorService } from './doctor.service';
import { ServiceCatalogService } from './service-catalog.service';
import { TenantStaffScopeService } from './tenant-staff-scope.service';
import type { TenantAppointmentRepository } from './appointment.repository';
import { APPOINTMENT_REPOSITORY } from './tenant-appointment.storage';
import type {
  FacilitySchedulingPolicyRecord,
  FacilitySchedulingPolicyRevisionRecord,
} from './appointment-scheduling-policy.repository';
import { FacilitySchedulingPolicyRepository } from './appointment-scheduling-policy.repository';
import {
  facilitySchedulingPolicyIdSchema,
  schedulingPolicyInputSchema,
  schedulingPolicyRulesSchema,
  schedulingPolicyTransitionSchema,
  type SchedulingPolicyInput,
  type SchedulingPolicyRules,
} from './appointment-scheduling-policy.dto';
import {
  SchedulingPolicyInputError,
  SchedulingPolicyNotFoundError,
  SchedulingPolicyReferenceInvalidError,
  SchedulingPolicyUnavailableError,
  SchedulingPolicyVersionConflictError,
} from './appointment-scheduling-policy.errors';
import {
  assertBookingWithinPolicy,
  assertCancellationWithinPolicy,
  assertReschedulingWithinPolicy,
  type ActiveSchedulingPolicy,
} from './appointment-scheduling-policy.enforcement';
import { isValidIanaTimeZone } from './appointment-scheduling-policy.dto';

export type SchedulingPolicyAuditContext = Pick<
  TrustedSecurityContext,
  'requestId' | 'ipAddress' | 'userAgent'
>;

export interface FacilitySchedulingPolicyResponse {
  id: string;
  facilityId: string;
  status: FacilitySchedulingPolicyStatus;
  timeZone: string;
  rules: SchedulingPolicyRules;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface FacilitySchedulingPolicyRevisionResponse {
  version: number;
  action: FacilitySchedulingPolicyRevisionAction;
  status: FacilitySchedulingPolicyStatus;
  timeZone: string;
  rules: SchedulingPolicyRules;
  actorUserId: string;
  createdAt: Date;
}

@Injectable()
export class FacilitySchedulingPolicyService {
  constructor(
    private readonly policies: FacilitySchedulingPolicyRepository,
    @Inject(APPOINTMENT_REPOSITORY)
    private readonly appointments: TenantAppointmentRepository,
    private readonly facilities: FacilityService,
    private readonly doctors: DoctorService,
    private readonly services: ServiceCatalogService,
    private readonly staffScopes: TenantStaffScopeService,
    private readonly audit: PlatformAuditService,
  ) {}

  async get(
    context: TrustedTenantContext,
    facilityId: string,
  ): Promise<FacilitySchedulingPolicyResponse> {
    const tenantId = this.tenantId(context);
    const facility = this.facilityId(facilityId);
    const policy = await this.read(() => this.policies.findByFacility(tenantId, facility));
    if (!policy) throw new SchedulingPolicyNotFoundError();
    return this.present(policy);
  }

  async put(
    context: TrustedTenantContext,
    facilityId: string,
    input: SchedulingPolicyInput,
    actor: AuthenticatedPlatformUser,
    requestContext: SchedulingPolicyAuditContext = {},
  ): Promise<FacilitySchedulingPolicyResponse> {
    const tenantId = this.tenantId(context);
    this.assertActor(context, actor);
    const facility = this.facilityId(facilityId);
    const parsed = schedulingPolicyInputSchema.safeParse(input);
    if (!parsed.success) throw new SchedulingPolicyInputError();

    const result = await this.appointments.withSchedulingLocks(
      context,
      [{ resourceType: 'FACILITY', resourceId: facility }],
      async () => {
        await this.assertPolicyReferences(context, facility, parsed.data.rules);
        return this.write(() =>
          this.policies.upsert({
            tenantId,
            facilityId: facility,
            expectedVersion: parsed.data.expectedVersion,
            timeZone: parsed.data.timeZone,
            rules: parsed.data.rules,
            actorUserId: actor.userId,
          }),
        );
      },
    );
    if (result.changed) {
      await this.auditPolicyChange(
        result.policy,
        actor,
        requestContext,
        result.policy.version === 1
          ? PlatformAuditEventType.SCHEDULING_POLICY_CREATED
          : PlatformAuditEventType.SCHEDULING_POLICY_UPDATED,
        result.policy.version === 1 ? 'created' : 'updated',
      );
    }
    return this.present(result.policy);
  }

  async activate(
    context: TrustedTenantContext,
    facilityId: string,
    input: unknown,
    actor: AuthenticatedPlatformUser,
    requestContext: SchedulingPolicyAuditContext = {},
  ): Promise<FacilitySchedulingPolicyResponse> {
    return this.transition(
      context,
      facilityId,
      input,
      actor,
      FacilitySchedulingPolicyStatus.ACTIVE,
      PlatformAuditEventType.SCHEDULING_POLICY_ACTIVATED,
      'activated',
      requestContext,
    );
  }

  async deactivate(
    context: TrustedTenantContext,
    facilityId: string,
    input: unknown,
    actor: AuthenticatedPlatformUser,
    requestContext: SchedulingPolicyAuditContext = {},
  ): Promise<FacilitySchedulingPolicyResponse> {
    return this.transition(
      context,
      facilityId,
      input,
      actor,
      FacilitySchedulingPolicyStatus.INACTIVE,
      PlatformAuditEventType.SCHEDULING_POLICY_DEACTIVATED,
      'deactivated',
      requestContext,
    );
  }

  async history(
    context: TrustedTenantContext,
    facilityId: string,
    query: { limit?: number | string; offset?: number | string } = {},
  ): Promise<{
    items: FacilitySchedulingPolicyRevisionResponse[];
    limit: number;
    offset: number;
    total: number;
    hasNext: boolean;
  }> {
    const tenantId = this.tenantId(context);
    const facility = this.facilityId(facilityId);
    const parsed = policyHistoryQuerySchema.safeParse(query);
    if (!parsed.success) throw new SchedulingPolicyInputError();
    const policy = await this.read(() => this.policies.findByFacility(tenantId, facility));
    if (!policy) throw new SchedulingPolicyNotFoundError();
    const { items, total } = await this.read(() =>
      this.policies.listRevisions(tenantId, facility, parsed.data.limit, parsed.data.offset),
    );
    return {
      items: items.map((revision) => this.presentRevision(revision)),
      limit: parsed.data.limit,
      offset: parsed.data.offset,
      total,
      hasNext: parsed.data.offset + items.length < total,
    };
  }

  async assertBookingAllowed(
    context: TrustedTenantContext,
    input: {
      facilityId: string;
      doctorId: string;
      serviceId: string | null;
      startsAt: Date;
      endsAt: Date;
    },
    now: Date = new Date(),
  ): Promise<void> {
    const tenantId = this.tenantId(context);
    const policy = await this.read(() =>
      this.policies.findActiveByFacility(tenantId, this.facilityId(input.facilityId)),
    );
    if (!policy) return;
    assertBookingWithinPolicy(this.activePolicy(policy), input, now);
  }

  async assertCancellationAllowed(
    context: TrustedTenantContext,
    facilityId: string,
    startsAt: Date,
    now: Date = new Date(),
  ): Promise<void> {
    const policy = await this.activePolicyForFacility(context, facilityId);
    if (policy) assertCancellationWithinPolicy(policy, startsAt, now);
  }

  async assertReschedulingAllowed(
    context: TrustedTenantContext,
    facilityId: string,
    startsAt: Date,
    now: Date = new Date(),
  ): Promise<void> {
    const policy = await this.activePolicyForFacility(context, facilityId);
    if (policy) assertReschedulingWithinPolicy(policy, startsAt, now);
  }

  private async transition(
    context: TrustedTenantContext,
    facilityId: string,
    input: unknown,
    actor: AuthenticatedPlatformUser,
    status: FacilitySchedulingPolicyStatus,
    eventType: PlatformAuditEventType,
    action: 'activated' | 'deactivated',
    requestContext: SchedulingPolicyAuditContext,
  ): Promise<FacilitySchedulingPolicyResponse> {
    const tenantId = this.tenantId(context);
    this.assertActor(context, actor);
    const facility = this.facilityId(facilityId);
    const parsed = schedulingPolicyTransitionSchema.safeParse(input);
    if (!parsed.success) throw new SchedulingPolicyInputError();

    const result = await this.appointments.withSchedulingLocks(
      context,
      [{ resourceType: 'FACILITY', resourceId: facility }],
      async () => {
        const current = await this.read(() => this.policies.findByFacility(tenantId, facility));
        if (!current) throw new SchedulingPolicyNotFoundError();
        if (current.version !== parsed.data.expectedVersion) {
          throw new SchedulingPolicyVersionConflictError();
        }
        if (status === FacilitySchedulingPolicyStatus.ACTIVE) {
          const rules = this.rules(current.rules);
          if (!isValidIanaTimeZone(current.timeZone)) {
            throw new SchedulingPolicyUnavailableError();
          }
          await this.assertPolicyReferences(context, facility, rules);
        }
        const changed = await this.write(() =>
          this.policies.setStatus({
            tenantId,
            facilityId: facility,
            expectedVersion: parsed.data.expectedVersion,
            status,
            actorUserId: actor.userId,
          }),
        );
        if (!changed.policy) throw new SchedulingPolicyNotFoundError();
        return changed;
      },
    );
    if (result.changed && result.policy) {
      await this.auditPolicyChange(result.policy, actor, requestContext, eventType, action);
    }
    if (!result.policy) throw new SchedulingPolicyNotFoundError();
    return this.present(result.policy);
  }

  private async activePolicyForFacility(
    context: TrustedTenantContext,
    facilityId: string,
  ): Promise<ActiveSchedulingPolicy | null> {
    const tenantId = this.tenantId(context);
    const facility = this.facilityId(facilityId);
    const record = await this.read(() => this.policies.findActiveByFacility(tenantId, facility));
    return record ? this.activePolicy(record) : null;
  }

  private activePolicy(record: FacilitySchedulingPolicyRecord): ActiveSchedulingPolicy {
    if (!isValidIanaTimeZone(record.timeZone)) {
      throw new SchedulingPolicyUnavailableError();
    }
    return { timeZone: record.timeZone, rules: this.rules(record.rules) };
  }

  private rules(value: unknown): SchedulingPolicyRules {
    const parsed = schedulingPolicyRulesSchema.safeParse(value);
    if (!parsed.success) throw new SchedulingPolicyUnavailableError();
    return parsed.data;
  }

  private async assertPolicyReferences(
    context: TrustedTenantContext,
    facilityId: string,
    rules: SchedulingPolicyRules,
  ): Promise<void> {
    try {
      const facility = await this.facilities.findById(context, facilityId);
      if (facility.status !== 'ACTIVE') throw new SchedulingPolicyReferenceInvalidError();

      for (const provider of rules.providerAvailability) {
        const doctor = await this.doctors.findById(context, provider.doctorId);
        if (!doctor.operationallyActive) throw new SchedulingPolicyReferenceInvalidError();
        const [facilityAssignments, branchAssignments] = await Promise.all([
          this.staffScopes.listFacilities(context, doctor.staffId),
          this.staffScopes.listBranches(context, doctor.staffId),
        ]);
        const assigned =
          facilityAssignments.items.some(
            (assignment) =>
              assignment.facilityId === facilityId && assignment.facilityStatus === 'ACTIVE',
          ) ||
          branchAssignments.items.some(
            (assignment) =>
              assignment.facility.id === facilityId &&
              assignment.facility.status === 'ACTIVE' &&
              assignment.branchStatus === 'ACTIVE',
          );
        if (!assigned) throw new SchedulingPolicyReferenceInvalidError();
      }

      for (const rule of rules.serviceDurationRules) {
        const service = await this.services.findById(context, rule.serviceId);
        if (service.status !== 'ACTIVE') throw new SchedulingPolicyReferenceInvalidError();
      }
    } catch (error) {
      if (error instanceof SchedulingPolicyReferenceInvalidError) throw error;
      if (error instanceof NotFoundException) throw new SchedulingPolicyReferenceInvalidError();
      throw error;
    }
  }

  private present(record: FacilitySchedulingPolicyRecord): FacilitySchedulingPolicyResponse {
    return {
      id: record.id,
      facilityId: record.facilityId,
      status: record.status,
      timeZone: record.timeZone,
      rules: this.rules(record.rules),
      version: record.version,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private presentRevision(
    record: FacilitySchedulingPolicyRevisionRecord,
  ): FacilitySchedulingPolicyRevisionResponse {
    return {
      version: record.version,
      action: record.action,
      status: record.status,
      timeZone: record.timeZone,
      rules: this.rules(record.rules),
      actorUserId: record.actorUserId,
      createdAt: record.createdAt,
    };
  }

  private async auditPolicyChange(
    record: FacilitySchedulingPolicyRecord,
    actor: AuthenticatedPlatformUser,
    requestContext: SchedulingPolicyAuditContext,
    eventType: PlatformAuditEventType,
    action: string,
  ): Promise<void> {
    await this.audit.recordAudit({
      eventType,
      actorUserId: actor.userId,
      subjectTenantId: record.tenantId,
      sessionId: actor.sessionId,
      ...requestContext,
      metadata: {
        targetType: 'FACILITY_SCHEDULING_POLICY',
        targetId: record.id,
        facilityId: record.facilityId,
        version: record.version,
        status: record.status,
        action,
      },
    });
  }

  private async read<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (
        error instanceof SchedulingPolicyNotFoundError ||
        error instanceof SchedulingPolicyVersionConflictError ||
        error instanceof SchedulingPolicyReferenceInvalidError ||
        error instanceof SchedulingPolicyInputError ||
        error instanceof SchedulingPolicyUnavailableError
      ) {
        throw error;
      }
      throw new SchedulingPolicyUnavailableError();
    }
  }

  private async write<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof SchedulingPolicyVersionConflictError) throw error;
      throw new SchedulingPolicyUnavailableError();
    }
  }

  private tenantId(context: TrustedTenantContext): string {
    if (
      !isWellFormedTrustedTenantContext(context) ||
      !tenantIdSchema.safeParse(context.tenantId).success ||
      !z.string().uuid().safeParse(context.membershipId).success ||
      !z.string().uuid().safeParse(context.platformUserId).success
    ) {
      throw new TenantContextInvalidError();
    }
    return context.tenantId.toLowerCase();
  }

  private facilityId(value: string): string {
    const parsed = facilitySchedulingPolicyIdSchema.safeParse(value);
    if (!parsed.success) throw new SchedulingPolicyInputError();
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
}

const policyHistoryQuerySchema = z
  .object({
    limit: z
      .union([z.number().int(), z.string().regex(/^\d+$/u).transform(Number)])
      .pipe(z.number().int().min(1).max(100))
      .default(50),
    offset: z
      .union([z.number().int(), z.string().regex(/^\d+$/u).transform(Number)])
      .pipe(z.number().int().min(0).max(100_000))
      .default(0),
  })
  .strict();
