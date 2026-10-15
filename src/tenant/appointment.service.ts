import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PlatformAuditEventType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
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
    private readonly audit: PlatformAuditService,
  ) {}

  async create(
    context: TrustedTenantContext,
    input: CreateAppointmentInput,
    actor: AuthenticatedPlatformUser,
    requestContext: AppointmentAuditContext = {},
  ): Promise<AppointmentResponse> {
    this.assertActor(context, actor);
    const parsed = createAppointmentSchema.safeParse(input);
    if (!parsed.success) throw new AppointmentInputValidationError();
    await this.assertCanAccessLocation(
      context,
      parsed.data.facilityId,
      parsed.data.branchId ?? null,
    );
    await this.validateReferences(context, {
      patientId: parsed.data.patientId,
      doctorId: parsed.data.doctorId,
      facilityId: parsed.data.facilityId,
      branchId: parsed.data.branchId ?? null,
      serviceId: parsed.data.serviceId ?? null,
      startsAt: parsed.data.startsAt,
      endsAt: parsed.data.endsAt,
    });
    if (
      await this.appointments.hasProviderOverlap(context, {
        doctorId: parsed.data.doctorId,
        startsAt: parsed.data.startsAt,
        endsAt: parsed.data.endsAt,
      })
    ) {
      throw new AppointmentScheduleConflictError();
    }

    const now = new Date();
    const record: AppointmentRecord = {
      id: randomUUID(),
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
    const created = await this.appointments.create(context, record);
    await this.audit.recordAudit({
      eventType: PlatformAuditEventType.APPOINTMENT_CREATED,
      actorUserId: actor.userId,
      subjectTenantId: context.tenantId,
      sessionId: actor.sessionId,
      ...requestContext,
      metadata: { appointmentId: created.id, action: 'created' },
    });
    return this.present(created);
  }

  async list(
    context: TrustedTenantContext,
    query: ListAppointmentsQuery,
  ): Promise<Omit<AppointmentListResult, 'items'> & { items: AppointmentResponse[] }> {
    const parsed = listAppointmentsQuerySchema.safeParse(query);
    if (!parsed.success) throw new AppointmentInputValidationError();
    const accessScope = await this.accessScope(context);
    this.assertQueryScope(accessScope, parsed.data);
    const result = await this.appointments.list(context, {
      ...parsed.data,
      accessScope,
    });
    return { ...result, items: result.items.map((record) => this.present(record)) };
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
    const updated = await this.appointments.update(context, current.id, current.version, patch);
    if (!updated) await this.throwStateConflictIfStale(context, current.id);
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
    await this.validateReferences(context, {
      patientId: current.patientId,
      ...next,
      serviceId: current.serviceId,
    });
    if (
      await this.appointments.hasProviderOverlap(context, {
        doctorId: next.doctorId,
        startsAt: next.startsAt,
        endsAt: next.endsAt,
        excludeId: current.id,
      })
    ) {
      throw new AppointmentScheduleConflictError();
    }
    if (
      current.doctorId === next.doctorId &&
      current.facilityId === next.facilityId &&
      current.branchId === next.branchId &&
      current.startsAt.getTime() === next.startsAt.getTime() &&
      current.endsAt.getTime() === next.endsAt.getTime()
    ) {
      return this.present(current);
    }

    const updated = await this.appointments.update(context, current.id, current.version, {
      ...next,
      updatedAt: new Date(),
      updatedBy: actor.userId,
    });
    if (!updated) await this.throwStateConflictIfStale(context, current.id);
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
    const now = new Date();
    const cancelled = await this.appointments.update(context, current.id, current.version, {
      status: 'CANCELLED',
      cancelledAt: now,
      cancelledBy: actor.userId,
      updatedAt: now,
      updatedBy: actor.userId,
    });
    if (!cancelled) await this.throwStateConflictIfStale(context, current.id);
    await this.audit.recordAudit({
      eventType: PlatformAuditEventType.APPOINTMENT_CANCELLED,
      actorUserId: actor.userId,
      subjectTenantId: context.tenantId,
      sessionId: actor.sessionId,
      ...requestContext,
      metadata: { appointmentId: current.id, action: 'cancelled' },
    });
    return this.present(cancelled!);
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
