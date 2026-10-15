import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PlatformAuditEventType } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import type { AuthenticatedPlatformUser } from '../auth/auth.types';
import { PlatformAuditService } from '../platform-security/platform-audit.service';
import type { TrustedTenantContext } from './tenant-context.contract';
import {
  TenantContextInvalidError,
  isWellFormedTrustedTenantContext,
} from './tenant-context.contract';
import type {
  AppointmentAccessScope,
  AppointmentListResult,
  AppointmentRecord,
  AppointmentResponse,
} from './appointment.model';
import {
  AppointmentIdInvalidError,
  AppointmentInputValidationError,
  AppointmentIdempotencyConflictError,
  AppointmentNotFoundError,
  AppointmentReferenceInvalidError,
  AppointmentScheduleConflictError,
  AppointmentScopeForbiddenError,
  AppointmentStateConflictError,
} from './appointment.errors';
import {
  appointmentIdSchema,
  createAppointmentSchema,
  listAppointmentsQuerySchema,
  rescheduleAppointmentSchema,
  updateAppointmentSchema,
  appointmentIdempotencyKeySchema,
} from './appointment.dto';
import type {
  CreateAppointmentInput,
  ListAppointmentsQuery,
  RescheduleAppointmentInput,
  UpdateAppointmentInput,
} from './appointment.dto';
import { TenantAppointmentRepository } from './appointment.repository';
import { APPOINTMENT_REPOSITORY } from './tenant-appointment.storage';
import { PatientService } from './patient.service';
import { DoctorService } from './doctor.service';
import { FacilityService } from './facility.service';
import { BranchService } from './branch.service';
import { ServiceCatalogService } from './service-catalog.service';
import { TenantStaffScopeService } from './tenant-staff-scope.service';
import { TenantAuthorizationService } from './tenant-authorization.service';
import type {
  AppointmentSchedulingLock,
  LockedAppointmentStorage,
} from './tenant-appointment.storage';
import { FacilitySchedulingPolicyService } from './appointment-scheduling-policy.service';
import { localDateRangeToUtc } from './appointment-timezone';
import { AppointmentTimeZoneUnavailableError } from './appointment.errors';

export interface AppointmentAuditContext {
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AppointmentService {
  constructor(
    @Inject(APPOINTMENT_REPOSITORY)
    private readonly appointments: TenantAppointmentRepository,
    private readonly patients: PatientService,
    private readonly doctors: DoctorService,
    private readonly facilities: FacilityService,
    private readonly branches: BranchService,
    private readonly services: ServiceCatalogService,
    private readonly staffScopes: TenantStaffScopeService,
    private readonly schedulingPolicies: FacilitySchedulingPolicyService,
    private readonly tenantAuthorization: TenantAuthorizationService,
    private readonly audit: PlatformAuditService,
  ) {}

  async create(
    context: TrustedTenantContext,
    input: CreateAppointmentInput,
    actor: AuthenticatedPlatformUser,
    requestContext: AppointmentAuditContext = {},
    idempotencyKey?: string,
  ): Promise<AppointmentResponse> {
    this.assertActor(context, actor);
    const parsed = createAppointmentSchema.safeParse(input);
    if (!parsed.success) throw new AppointmentInputValidationError();
    if (
      idempotencyKey !== undefined &&
      !appointmentIdempotencyKeySchema.safeParse(idempotencyKey).success
    ) {
      throw new AppointmentInputValidationError();
    }
    await this.assertCanAccessLocation(
      context,
      parsed.data.facilityId,
      parsed.data.branchId ?? null,
    );
    const now = new Date();
    const record: AppointmentRecord = {
      id: idempotencyKey
        ? deterministicAppointmentId(context.tenantId, actor.userId, idempotencyKey)
        : randomUUID(),
      patientId: parsed.data.patientId,
      doctorId: parsed.data.doctorId,
      facilityId: parsed.data.facilityId,
      branchId: parsed.data.branchId ?? null,
      serviceId: parsed.data.serviceId ?? null,
      startsAt: parsed.data.startsAt,
      endsAt: parsed.data.endsAt,
      status: 'SCHEDULED',
      reason: parsed.data.reason ?? null,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.userId,
      updatedBy: actor.userId,
      cancelledAt: null,
      cancelledBy: null,
      version: 1,
    };
    const locks: AppointmentSchedulingLock[] = [
      { resourceType: 'FACILITY', resourceId: record.facilityId },
      { resourceType: 'DOCTOR', resourceId: record.doctorId },
      ...(idempotencyKey ? [{ resourceType: 'IDEMPOTENCY' as const, resourceId: record.id }] : []),
    ];
    const result = await this.appointments.withSchedulingLocks(context, locks, async (storage) => {
      if (idempotencyKey) {
        const existing = await storage.findById(record.id);
        if (existing) {
          if (!matchesIdempotentCreate(existing, record)) {
            throw new AppointmentIdempotencyConflictError();
          }
          return { appointment: existing, created: false };
        }
      }
      await this.validateReferences(context, {
        patientId: record.patientId,
        doctorId: record.doctorId,
        facilityId: record.facilityId,
        branchId: record.branchId,
        serviceId: record.serviceId,
        startsAt: record.startsAt,
        endsAt: record.endsAt,
      });
      await this.schedulingPolicies.assertBookingAllowed(context, {
        facilityId: record.facilityId,
        doctorId: record.doctorId,
        serviceId: record.serviceId,
        startsAt: record.startsAt,
        endsAt: record.endsAt,
      });
      if (
        await storage.hasProviderOverlap({
          doctorId: record.doctorId,
          startsAt: record.startsAt,
          endsAt: record.endsAt,
        })
      ) {
        throw new AppointmentScheduleConflictError();
      }
      return { appointment: await storage.create(record), created: true };
    });
    if (result.created) {
      await this.audit.recordAudit({
        eventType: PlatformAuditEventType.APPOINTMENT_CREATED,
        actorUserId: actor.userId,
        subjectTenantId: context.tenantId,
        sessionId: actor.sessionId,
        ...requestContext,
        metadata: { appointmentId: result.appointment.id, action: 'created' },
      });
    }
    return this.present(result.appointment);
  }

  async list(
    context: TrustedTenantContext,
    query: ListAppointmentsQuery,
  ): Promise<Omit<AppointmentListResult, 'items'> & { items: AppointmentResponse[] }> {
    const parsed = listAppointmentsQuerySchema.safeParse(query);
    if (!parsed.success) throw new AppointmentInputValidationError();
    const accessScope = await this.accessScope(context);
    this.assertQueryScope(accessScope, parsed.data);
    if (parsed.data.patientId) {
      await this.tenantAuthorization.authorize(context, 'tenant.patients.read');
    }
    let searchPatientRecords = false;
    if (parsed.data.search) {
      if (appointmentIdSchema.safeParse(parsed.data.search).success) {
        const permissions = await this.tenantAuthorization.getEffectivePermissionCodes(context);
        searchPatientRecords = permissions.includes('tenant.patients.read');
      } else {
        await this.tenantAuthorization.authorize(context, 'tenant.patients.read');
        searchPatientRecords = true;
      }
    }
    let from = parsed.data.from;
    let to = parsed.data.to;
    if (parsed.data.fromDate || parsed.data.toDate) {
      const timeZone = await this.schedulingPolicies.effectiveTimeZone(
        context,
        parsed.data.facilityId!,
      );
      if (!timeZone) throw new AppointmentTimeZoneUnavailableError();
      try {
        const range = localDateRangeToUtc(parsed.data.fromDate, parsed.data.toDate, timeZone);
        from = range.from;
        to = range.to;
      } catch {
        throw new AppointmentInputValidationError();
      }
    }
    const storageQuery = {
      ...parsed.data,
      from,
      to,
      searchPatientRecords,
      accessScope,
    };
    delete storageQuery.fromDate;
    delete storageQuery.toDate;
    const result = await this.appointments.list(context, storageQuery);
    return { ...result, items: result.items.map((record) => this.present(record)) };
  }

  async effectiveTimeZones(
    context: TrustedTenantContext,
    facilityIds: string[],
  ): Promise<{
    items: Array<{
      facilityId: string;
      timeZone: string | null;
      status: 'ACTIVE_POLICY' | 'NO_ACTIVE_POLICY';
    }>;
  }> {
    const membershipScope = await this.staffScopes.resolveMembershipScope(context);
    const uniqueFacilityIds = [...new Set(facilityIds)];
    if (
      membershipScope !== null &&
      uniqueFacilityIds.some(
        (facilityId) =>
          !membershipScope.facilities.some((facility) => facility.id === facilityId) &&
          !membershipScope.branches.some((branch) => branch.facilityId === facilityId),
      )
    ) {
      throw new AppointmentScopeForbiddenError();
    }
    const timeZones = await this.schedulingPolicies.effectiveTimeZones(context, uniqueFacilityIds);
    const items = uniqueFacilityIds.map((facilityId) => {
      const timeZone = timeZones.get(facilityId) ?? null;
      return {
        facilityId,
        timeZone,
        status: timeZone ? ('ACTIVE_POLICY' as const) : ('NO_ACTIVE_POLICY' as const),
      };
    });
    return { items };
  }

  async findById(
    context: TrustedTenantContext,
    appointmentId: string,
  ): Promise<AppointmentResponse> {
    const current = await this.findAuthorized(context, appointmentId);
    return this.present(current);
  }

  async update(
    context: TrustedTenantContext,
    appointmentId: string,
    input: UpdateAppointmentInput,
    actor: AuthenticatedPlatformUser,
    requestContext: AppointmentAuditContext = {},
  ): Promise<AppointmentResponse> {
    this.assertActor(context, actor);
    const current = await this.findAuthorized(context, appointmentId);
    const parsed = updateAppointmentSchema.safeParse(input);
    if (!parsed.success) throw new AppointmentInputValidationError();
    if (current.status !== 'SCHEDULED') throw new AppointmentStateConflictError();

    const patientId = parsed.data.patientId ?? current.patientId;
    const serviceId =
      parsed.data.serviceId === undefined ? current.serviceId : parsed.data.serviceId;
    await this.validateReferences(context, {
      patientId,
      doctorId: current.doctorId,
      facilityId: current.facilityId,
      branchId: current.branchId,
      serviceId,
      startsAt: current.startsAt,
      endsAt: current.endsAt,
    });
    const patch = {
      ...(parsed.data.patientId === undefined ? {} : { patientId: parsed.data.patientId }),
      ...(parsed.data.serviceId === undefined ? {} : { serviceId: parsed.data.serviceId }),
      ...(parsed.data.reason === undefined ? {} : { reason: parsed.data.reason }),
      updatedAt: new Date(),
      updatedBy: actor.userId,
    };
    if (Object.keys(patch).length === 2) return this.present(current);
    const updated = await this.appointments.withSchedulingLocks(
      context,
      appointmentLocks(current),
      async (storage) => {
        const latest = await this.readLockedAppointment(storage, current.id);
        if (latest.version !== current.version || latest.status !== 'SCHEDULED') {
          throw new AppointmentStateConflictError();
        }
        if (parsed.data.serviceId !== undefined) {
          await this.schedulingPolicies.assertBookingAllowed(context, {
            facilityId: latest.facilityId,
            doctorId: latest.doctorId,
            serviceId,
            startsAt: latest.startsAt,
            endsAt: latest.endsAt,
          });
        }
        return storage.update(current.id, current.version, patch);
      },
    );
    if (!updated) throw new AppointmentStateConflictError();
    await this.audit.recordAudit({
      eventType: PlatformAuditEventType.APPOINTMENT_UPDATED,
      actorUserId: actor.userId,
      subjectTenantId: context.tenantId,
      sessionId: actor.sessionId,
      ...requestContext,
      metadata: {
        appointmentId: current.id,
        action: 'updated',
        changedFields: Object.keys(parsed.data),
      },
    });
    return this.present(updated!);
  }

  async reschedule(
    context: TrustedTenantContext,
    appointmentId: string,
    input: RescheduleAppointmentInput,
    actor: AuthenticatedPlatformUser,
    requestContext: AppointmentAuditContext = {},
  ): Promise<AppointmentResponse> {
    this.assertActor(context, actor);
    const current = await this.findAuthorized(context, appointmentId);
    const parsed = rescheduleAppointmentSchema.safeParse(input);
    if (!parsed.success) throw new AppointmentInputValidationError();
    if (current.status !== 'SCHEDULED') throw new AppointmentStateConflictError();

    const next = {
      doctorId: parsed.data.doctorId ?? current.doctorId,
      facilityId: parsed.data.facilityId ?? current.facilityId,
      branchId: parsed.data.branchId === undefined ? current.branchId : parsed.data.branchId,
      startsAt: parsed.data.startsAt,
      endsAt: parsed.data.endsAt,
    };
    await this.assertCanAccessLocation(context, next.facilityId, next.branchId);
    if (
      current.doctorId === next.doctorId &&
      current.facilityId === next.facilityId &&
      current.branchId === next.branchId &&
      current.startsAt.getTime() === next.startsAt.getTime() &&
      current.endsAt.getTime() === next.endsAt.getTime()
    ) {
      return this.present(current);
    }

    const locks = [
      ...appointmentLocks(current),
      { resourceType: 'DOCTOR' as const, resourceId: next.doctorId },
      { resourceType: 'FACILITY' as const, resourceId: next.facilityId },
    ];
    const updated = await this.appointments.withSchedulingLocks(context, locks, async (storage) => {
      const latest = await this.readLockedAppointment(storage, current.id);
      if (latest.version !== current.version || latest.status !== 'SCHEDULED') {
        throw new AppointmentStateConflictError();
      }
      if (
        !(await this.canAccessLocation(context, latest.facilityId, latest.branchId)) ||
        !(await this.canAccessLocation(context, next.facilityId, next.branchId))
      ) {
        throw new AppointmentNotFoundError();
      }
      await this.validateReferences(context, {
        patientId: latest.patientId,
        ...next,
        serviceId: latest.serviceId,
      });
      const now = new Date();
      await this.schedulingPolicies.assertReschedulingAllowed(
        context,
        latest.facilityId,
        latest.startsAt,
        now,
      );
      await this.schedulingPolicies.assertBookingAllowed(
        context,
        {
          facilityId: next.facilityId,
          doctorId: next.doctorId,
          serviceId: latest.serviceId,
          startsAt: next.startsAt,
          endsAt: next.endsAt,
        },
        now,
      );
      if (
        await storage.hasProviderOverlap({
          doctorId: next.doctorId,
          startsAt: next.startsAt,
          endsAt: next.endsAt,
          excludeId: current.id,
        })
      ) {
        throw new AppointmentScheduleConflictError();
      }
      return storage.update(current.id, current.version, {
        ...next,
        updatedAt: new Date(),
        updatedBy: actor.userId,
      });
    });
    if (!updated) throw new AppointmentStateConflictError();
    await this.audit.recordAudit({
      eventType: PlatformAuditEventType.APPOINTMENT_RESCHEDULED,
      actorUserId: actor.userId,
      subjectTenantId: context.tenantId,
      sessionId: actor.sessionId,
      ...requestContext,
      metadata: {
        appointmentId: current.id,
        action: 'rescheduled',
        changedFields: Object.keys(next),
      },
    });
    return this.present(updated!);
  }

  async cancel(
    context: TrustedTenantContext,
    appointmentId: string,
    actor: AuthenticatedPlatformUser,
    requestContext: AppointmentAuditContext = {},
  ): Promise<AppointmentResponse> {
    this.assertActor(context, actor);
    const current = await this.findAuthorized(context, appointmentId);
    if (current.status === 'CANCELLED') return this.present(current);
    const cancellation = await this.appointments.withSchedulingLocks(
      context,
      appointmentLocks(current),
      async (storage) => {
        const latest = await this.readLockedAppointment(storage, current.id);
        if (latest.status === 'CANCELLED') return { appointment: latest, changed: false };
        if (latest.version !== current.version || latest.status !== 'SCHEDULED') {
          throw new AppointmentStateConflictError();
        }
        await this.schedulingPolicies.assertCancellationAllowed(
          context,
          latest.facilityId,
          latest.startsAt,
        );
        const now = new Date();
        const appointment = await storage.update(current.id, current.version, {
          status: 'CANCELLED',
          cancelledAt: now,
          cancelledBy: actor.userId,
          updatedAt: now,
          updatedBy: actor.userId,
        });
        return { appointment, changed: true };
      },
    );
    const cancelled = cancellation.appointment;
    if (!cancelled) throw new AppointmentStateConflictError();
    if (cancellation.changed) {
      await this.audit.recordAudit({
        eventType: PlatformAuditEventType.APPOINTMENT_CANCELLED,
        actorUserId: actor.userId,
        subjectTenantId: context.tenantId,
        sessionId: actor.sessionId,
        ...requestContext,
        metadata: { appointmentId: current.id, action: 'cancelled' },
      });
    }
    return this.present(cancelled);
  }

  private async findAuthorized(
    context: TrustedTenantContext,
    appointmentId: string,
  ): Promise<AppointmentRecord> {
    const parsedId = appointmentIdSchema.safeParse(appointmentId);
    if (!parsedId.success) throw new AppointmentIdInvalidError();
    const record = await this.appointments.findById(context, parsedId.data);
    if (!record) throw new AppointmentNotFoundError();
    if (!(await this.canAccessLocation(context, record.facilityId, record.branchId))) {
      throw new AppointmentNotFoundError();
    }
    return record;
  }

  private async throwStateConflictIfStale(
    context: TrustedTenantContext,
    id: string,
  ): Promise<never> {
    const latest = await this.appointments.findById(context, id);
    if (!latest) throw new AppointmentNotFoundError();
    throw new AppointmentStateConflictError();
  }

  private async readLockedAppointment(
    storage: LockedAppointmentStorage,
    id: string,
  ): Promise<AppointmentRecord> {
    const record = await storage.findById(id);
    if (!record) throw new AppointmentNotFoundError();
    return record;
  }

  private async validateReferences(
    context: TrustedTenantContext,
    input: {
      patientId: string;
      doctorId: string;
      facilityId: string;
      branchId: string | null;
      serviceId: string | null;
      startsAt: Date;
      endsAt: Date;
    },
  ): Promise<void> {
    const [patient, doctor, facility, service] = await Promise.all([
      this.reference(() => this.patients.findById(context, input.patientId)),
      this.reference(() => this.doctors.findById(context, input.doctorId)),
      this.reference(() => this.facilities.findById(context, input.facilityId)),
      input.serviceId
        ? this.reference(() => this.services.findById(context, input.serviceId!))
        : Promise.resolve(null),
    ]);
    if (
      patient.status !== 'ACTIVE' ||
      !doctor.operationallyActive ||
      facility.status !== 'ACTIVE'
    ) {
      throw new AppointmentReferenceInvalidError();
    }
    if (service && service.status !== 'ACTIVE') throw new AppointmentReferenceInvalidError();

    if (input.branchId) {
      const branch = await this.reference(() =>
        this.branches.findById(context, input.facilityId, input.branchId!),
      );
      if (branch.facilityId !== input.facilityId || branch.status !== 'ACTIVE') {
        throw new AppointmentReferenceInvalidError();
      }
    }
    await this.assertDoctorAssignedToLocation(
      context,
      doctor.staffId,
      input.facilityId,
      input.branchId,
    );
  }

  private async assertDoctorAssignedToLocation(
    context: TrustedTenantContext,
    staffId: string,
    facilityId: string,
    branchId: string | null,
  ): Promise<void> {
    const [facilityAssignments, branchAssignments] = await Promise.all([
      this.staffScopes.listFacilities(context, staffId),
      this.staffScopes.listBranches(context, staffId),
    ]);
    const assignedToFacility = facilityAssignments.items.some(
      (assignment) =>
        assignment.facilityId === facilityId && assignment.facilityStatus === 'ACTIVE',
    );
    const assignedToBranch =
      branchId !== null &&
      branchAssignments.items.some(
        (assignment) =>
          assignment.branchId === branchId &&
          assignment.facility.id === facilityId &&
          assignment.branchStatus === 'ACTIVE' &&
          assignment.facility.status === 'ACTIVE',
      );
    if (!assignedToFacility && !assignedToBranch) {
      throw new AppointmentReferenceInvalidError();
    }
  }

  private async reference<T>(lookup: () => Promise<T>): Promise<T> {
    try {
      return await lookup();
    } catch (error) {
      if (error instanceof NotFoundException) throw new AppointmentReferenceInvalidError();
      throw error;
    }
  }

  private async assertCanAccessLocation(
    context: TrustedTenantContext,
    facilityId: string,
    branchId: string | null,
  ): Promise<void> {
    const scope = await this.accessScope(context);
    if (!this.hasLocationAccess(scope, facilityId, branchId)) {
      throw new AppointmentScopeForbiddenError();
    }
  }

  private async canAccessLocation(
    context: TrustedTenantContext,
    facilityId: string,
    branchId: string | null,
  ): Promise<boolean> {
    const scope = await this.accessScope(context);
    return this.hasLocationAccess(scope, facilityId, branchId);
  }

  private async accessScope(context: TrustedTenantContext): Promise<AppointmentAccessScope> {
    const scope = await this.staffScopes.resolveMembershipScope(context);
    if (scope === null) return { unrestricted: true, facilityIds: [], branchIds: [] };
    return {
      unrestricted: false,
      facilityIds: scope.facilities.map(({ id }) => id),
      branchIds: scope.branches.map(({ id }) => id),
    };
  }

  private assertQueryScope(scope: AppointmentAccessScope, query: ListAppointmentsQuery): void {
    if (scope.unrestricted) return;
    if (
      query.facilityId &&
      !scope.facilityIds.includes(query.facilityId) &&
      !(query.branchId && scope.branchIds.includes(query.branchId))
    ) {
      throw new AppointmentScopeForbiddenError();
    }
    if (
      query.branchId &&
      !scope.branchIds.includes(query.branchId) &&
      !(query.facilityId && scope.facilityIds.includes(query.facilityId))
    ) {
      throw new AppointmentScopeForbiddenError();
    }
  }

  private hasLocationAccess(
    scope: AppointmentAccessScope,
    facilityId: string,
    branchId: string | null,
  ): boolean {
    return (
      scope.unrestricted ||
      scope.facilityIds.includes(facilityId) ||
      (branchId !== null && scope.branchIds.includes(branchId))
    );
  }

  private assertActor(context: TrustedTenantContext, actor: AuthenticatedPlatformUser): void {
    if (
      !isWellFormedTrustedTenantContext(context) ||
      !actor ||
      actor.userId.toLowerCase() !== context.platformUserId.toLowerCase()
    ) {
      throw new TenantContextInvalidError();
    }
  }

  private present(record: AppointmentRecord): AppointmentResponse {
    return {
      id: record.id,
      patientId: record.patientId,
      doctorId: record.doctorId,
      facilityId: record.facilityId,
      branchId: record.branchId,
      serviceId: record.serviceId,
      startsAt: record.startsAt,
      endsAt: record.endsAt,
      status: record.status,
      reason: record.reason,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      cancelledAt: record.cancelledAt,
    };
  }
}

function appointmentLocks(record: AppointmentRecord): AppointmentSchedulingLock[] {
  return [
    { resourceType: 'DOCTOR', resourceId: record.doctorId },
    { resourceType: 'FACILITY', resourceId: record.facilityId },
  ];
}

function matchesIdempotentCreate(
  existing: AppointmentRecord,
  requested: AppointmentRecord,
): boolean {
  return (
    existing.patientId === requested.patientId &&
    existing.doctorId === requested.doctorId &&
    existing.facilityId === requested.facilityId &&
    existing.branchId === requested.branchId &&
    existing.serviceId === requested.serviceId &&
    existing.startsAt.getTime() === requested.startsAt.getTime() &&
    existing.endsAt.getTime() === requested.endsAt.getTime() &&
    existing.status === requested.status &&
    existing.reason === requested.reason &&
    existing.createdBy === requested.createdBy
  );
}

function deterministicAppointmentId(
  tenantId: string,
  actorUserId: string,
  idempotencyKey: string,
): string {
  const digest = createHash('sha256')
    .update(`${tenantId.toLowerCase()}\u0000${actorUserId.toLowerCase()}\u0000${idempotencyKey}`)
    .digest('hex')
    .slice(0, 32)
    .split('');
  digest[12] = '5';
  digest[16] = ((Number.parseInt(digest[16], 16) & 0x3) | 0x8).toString(16);
  const hex = digest.join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
