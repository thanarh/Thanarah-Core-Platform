import { Injectable } from '@nestjs/common';
import {
  PlatformAuditEventType,
  StaffStatus,
  TenantCatalogStatus,
  TenantStatus,
} from '@prisma/client';
import { z } from 'zod';
import type { AuthenticatedPlatformUser } from '../auth/auth.types';
import { PlatformAuditService } from '../platform-security/platform-audit.service';
import type { TrustedSecurityContext } from '../platform-security/platform-security.types';
import { TenantContextInvalidError, TenantContextRequiredError } from './tenant-context.contract';
import type { TrustedTenantContext } from './tenant-context.contract';
import { tenantIdSchema } from './tenant.dto';
import {
  createDoctorSchema,
  doctorDepartmentAssignmentSchema,
  doctorIdSchema,
  doctorSpecialtyAssignmentSchema,
  listDoctorsQuerySchema,
  updateDoctorSchema,
  type CreateDoctorInput,
  type DoctorDepartmentAssignmentInput,
  type DoctorSpecialtyAssignmentInput,
  type ListDoctorsQuery,
  type UpdateDoctorInput,
} from './doctor.dto';
import {
  DoctorAlreadyExistsError,
  DoctorAssignmentConflictError,
  DoctorAssignmentNotFoundError,
  DoctorAssignmentTargetNotFoundError,
  DoctorIdInvalidError,
  DoctorInputValidationError,
  DoctorLifecycleConflictError,
  DoctorNotFoundError,
  DoctorStaffIneligibleError,
  DoctorStaffNotFoundError,
  DoctorTenantUnavailableError,
} from './doctor.errors';
import {
  DoctorRepository,
  type CreateDoctorResult,
  type DoctorMutationResult,
  type DoctorRecord,
} from './doctor.repository';

export type DoctorAuditContext = Pick<
  TrustedSecurityContext,
  'requestId' | 'ipAddress' | 'userAgent'
>;

export interface DoctorDepartmentResponse {
  id: string;
  name: string;
  status: TenantCatalogStatus;
  assignedAt: Date;
}

export interface DoctorSpecialtyResponse {
  id: string;
  name: string;
  status: TenantCatalogStatus;
  assignedAt: Date;
}

export interface DoctorResponse {
  id: string;
  tenantId: string;
  staffId: string;
  staff: { id: string; displayName: string; status: StaffStatus };
  professionalDisplayName: string | null;
  status: StaffStatus;
  operationallyActive: boolean;
  departments: DoctorDepartmentResponse[];
  specialties: DoctorSpecialtyResponse[];
  statusChangedAt: Date;
  suspendedAt: Date | null;
  deactivatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DoctorListResponse {
  items: DoctorResponse[];
  limit: number;
  offset: number;
}

@Injectable()
export class DoctorService {
  constructor(
    private readonly doctors: DoctorRepository,
    private readonly audit: PlatformAuditService,
  ) {}

  async create(
    context: TrustedTenantContext,
    input: CreateDoctorInput,
    actor: AuthenticatedPlatformUser,
    requestContext: DoctorAuditContext = {},
  ): Promise<DoctorResponse> {
    const tenantId = this.tenantId(context);
    this.assertActor(context, actor);
    const parsed = createDoctorSchema.safeParse(input);
    if (!parsed.success) throw new DoctorInputValidationError();

    const result = await this.doctors.create(tenantId, parsed.data);
    const doctor = this.createdRecord(result);

    await this.audit.recordAudit({
      eventType: PlatformAuditEventType.DOCTOR_CREATED,
      actorUserId: actor.userId,
      subjectUserId: doctor.staff.userId,
      subjectTenantId: tenantId,
      sessionId: actor.sessionId,
      ...requestContext,
      metadata: {
        doctorId: doctor.id,
        staffId: doctor.staffId,
        status: doctor.status,
      },
    });
    for (const assignment of doctor.departmentAssignments) {
      await this.auditAssignment(
        PlatformAuditEventType.DOCTOR_DEPARTMENT_ASSIGNED,
        actor,
        tenantId,
        doctor,
        { departmentId: assignment.department.id },
        requestContext,
      );
    }
    for (const assignment of doctor.specialtyAssignments) {
      await this.auditAssignment(
        PlatformAuditEventType.DOCTOR_SPECIALTY_ASSIGNED,
        actor,
        tenantId,
        doctor,
        { specialtyId: assignment.specialty.id },
        requestContext,
      );
    }
    return this.present(doctor);
  }

  async list(context: TrustedTenantContext, query: ListDoctorsQuery): Promise<DoctorListResponse> {
    const tenantId = this.tenantId(context);
    const parsed = listDoctorsQuerySchema.safeParse(query);
    if (!parsed.success) throw new DoctorInputValidationError();
    const { limit, offset, status } = parsed.data;
    const items = await this.doctors.listForTenant(tenantId, { status, limit, offset });
    return { items: items.map((doctor) => this.present(doctor)), limit, offset };
  }

  async findById(context: TrustedTenantContext, doctorId: string): Promise<DoctorResponse> {
    const tenantId = this.tenantId(context);
    const id = this.id(doctorId);
    const doctor = await this.doctors.findByIdForTenant(tenantId, id);
    if (!doctor) throw new DoctorNotFoundError();
    return this.present(doctor);
  }

  async update(
    context: TrustedTenantContext,
    doctorId: string,
    input: UpdateDoctorInput,
    actor: AuthenticatedPlatformUser,
    requestContext: DoctorAuditContext = {},
  ): Promise<DoctorResponse> {
    const tenantId = this.tenantId(context);
    this.assertActor(context, actor);
    const id = this.id(doctorId);
    const parsed = updateDoctorSchema.safeParse(input);
    if (!parsed.success) throw new DoctorInputValidationError();
    const current = await this.doctors.findByIdForTenant(tenantId, id);
    if (!current) throw new DoctorNotFoundError();
    if (current.professionalDisplayName === parsed.data.professionalDisplayName) {
      return this.present(current);
    }

    const updated = this.changedRecord(
      await this.doctors.updateForTenant(tenantId, id, parsed.data),
    );
    await this.audit.recordAudit({
      eventType: PlatformAuditEventType.DOCTOR_UPDATED,
      actorUserId: actor.userId,
      subjectUserId: updated.staff.userId,
      subjectTenantId: tenantId,
      sessionId: actor.sessionId,
      ...requestContext,
      metadata: {
        doctorId: updated.id,
        staffId: updated.staffId,
        changedFields: 'professionalDisplayName',
      },
    });
    return this.present(updated);
  }

  activate(
    context: TrustedTenantContext,
    doctorId: string,
    actor: AuthenticatedPlatformUser,
    requestContext: DoctorAuditContext = {},
  ): Promise<DoctorResponse> {
    return this.transition(context, doctorId, StaffStatus.ACTIVE, actor, requestContext);
  }

  suspend(
    context: TrustedTenantContext,
    doctorId: string,
    actor: AuthenticatedPlatformUser,
    requestContext: DoctorAuditContext = {},
  ): Promise<DoctorResponse> {
    return this.transition(context, doctorId, StaffStatus.SUSPENDED, actor, requestContext);
  }

  deactivate(
    context: TrustedTenantContext,
    doctorId: string,
    actor: AuthenticatedPlatformUser,
    requestContext: DoctorAuditContext = {},
  ): Promise<DoctorResponse> {
    return this.transition(context, doctorId, StaffStatus.DEACTIVATED, actor, requestContext);
  }

  async listDepartments(
    context: TrustedTenantContext,
    doctorId: string,
  ): Promise<{ items: DoctorDepartmentResponse[] }> {
    const doctor = await this.findById(context, doctorId);
    return { items: doctor.departments };
  }

  async assignDepartment(
    context: TrustedTenantContext,
    doctorId: string,
    input: DoctorDepartmentAssignmentInput,
    actor: AuthenticatedPlatformUser,
    requestContext: DoctorAuditContext = {},
  ): Promise<DoctorResponse> {
    const tenantId = this.tenantId(context);
    this.assertActor(context, actor);
    const id = this.id(doctorId);
    const parsed = doctorDepartmentAssignmentSchema.safeParse(input);
    if (!parsed.success) throw new DoctorInputValidationError();
    const updated = this.changedRecord(
      await this.doctors.assignDepartment(tenantId, id, parsed.data.departmentId),
      'department',
    );
    await this.auditAssignment(
      PlatformAuditEventType.DOCTOR_DEPARTMENT_ASSIGNED,
      actor,
      tenantId,
      updated,
      { departmentId: parsed.data.departmentId },
      requestContext,
    );
    return this.present(updated);
  }

  async unassignDepartment(
    context: TrustedTenantContext,
    doctorId: string,
    departmentId: string,
    actor: AuthenticatedPlatformUser,
    requestContext: DoctorAuditContext = {},
  ): Promise<DoctorResponse> {
    const tenantId = this.tenantId(context);
    this.assertActor(context, actor);
    const id = this.id(doctorId);
    const targetId = this.id(departmentId);
    const updated = this.changedRecord(
      await this.doctors.unassignDepartment(tenantId, id, targetId),
      'department',
    );
    await this.auditAssignment(
      PlatformAuditEventType.DOCTOR_DEPARTMENT_UNASSIGNED,
      actor,
      tenantId,
      updated,
      { departmentId: targetId },
      requestContext,
    );
    return this.present(updated);
  }

  async listSpecialties(
    context: TrustedTenantContext,
    doctorId: string,
  ): Promise<{ items: DoctorSpecialtyResponse[] }> {
    const doctor = await this.findById(context, doctorId);
    return { items: doctor.specialties };
  }

  async assignSpecialty(
    context: TrustedTenantContext,
    doctorId: string,
    input: DoctorSpecialtyAssignmentInput,
    actor: AuthenticatedPlatformUser,
    requestContext: DoctorAuditContext = {},
  ): Promise<DoctorResponse> {
    const tenantId = this.tenantId(context);
    this.assertActor(context, actor);
    const id = this.id(doctorId);
    const parsed = doctorSpecialtyAssignmentSchema.safeParse(input);
    if (!parsed.success) throw new DoctorInputValidationError();
    const updated = this.changedRecord(
      await this.doctors.assignSpecialty(tenantId, id, parsed.data.specialtyId),
      'specialty',
    );
    await this.auditAssignment(
      PlatformAuditEventType.DOCTOR_SPECIALTY_ASSIGNED,
      actor,
      tenantId,
      updated,
      { specialtyId: parsed.data.specialtyId },
      requestContext,
    );
    return this.present(updated);
  }

  async unassignSpecialty(
    context: TrustedTenantContext,
    doctorId: string,
    specialtyId: string,
    actor: AuthenticatedPlatformUser,
    requestContext: DoctorAuditContext = {},
  ): Promise<DoctorResponse> {
    const tenantId = this.tenantId(context);
    this.assertActor(context, actor);
    const id = this.id(doctorId);
    const targetId = this.id(specialtyId);
    const updated = this.changedRecord(
      await this.doctors.unassignSpecialty(tenantId, id, targetId),
      'specialty',
    );
    await this.auditAssignment(
      PlatformAuditEventType.DOCTOR_SPECIALTY_UNASSIGNED,
      actor,
      tenantId,
      updated,
      { specialtyId: targetId },
      requestContext,
    );
    return this.present(updated);
  }

  private async transition(
    context: TrustedTenantContext,
    doctorId: string,
    nextStatus: StaffStatus,
    actor: AuthenticatedPlatformUser,
    requestContext: DoctorAuditContext,
  ): Promise<DoctorResponse> {
    const tenantId = this.tenantId(context);
    this.assertActor(context, actor);
    const id = this.id(doctorId);
    const current = await this.doctors.findByIdForTenant(tenantId, id);
    if (!current) throw new DoctorNotFoundError();
    if (current.status === nextStatus) return this.present(current);
    if (!this.canTransition(current.status, nextStatus)) {
      throw new DoctorLifecycleConflictError();
    }
    const result = await this.doctors.changeStatusIfCurrent(
      tenantId,
      id,
      current.status,
      nextStatus,
      new Date(),
    );
    if (result.kind === 'not-changed') {
      const latest = await this.doctors.findByIdForTenant(tenantId, id);
      if (!latest) throw new DoctorNotFoundError();
      if (latest.status === nextStatus) return this.present(latest);
      throw new DoctorLifecycleConflictError();
    }
    const updated = this.changedRecord(result);
    await this.audit.recordAudit({
      eventType: this.statusAuditEvent(nextStatus),
      actorUserId: actor.userId,
      subjectUserId: updated.staff.userId,
      subjectTenantId: tenantId,
      sessionId: actor.sessionId,
      ...requestContext,
      metadata: {
        doctorId: updated.id,
        staffId: updated.staffId,
        fromStatus: current.status,
        toStatus: updated.status,
      },
    });
    return this.present(updated);
  }

  private async auditAssignment(
    eventType: PlatformAuditEventType,
    actor: AuthenticatedPlatformUser,
    tenantId: string,
    doctor: DoctorRecord,
    target: { departmentId: string } | { specialtyId: string },
    requestContext: DoctorAuditContext,
  ): Promise<void> {
    await this.audit.recordAudit({
      eventType,
      actorUserId: actor.userId,
      subjectUserId: doctor.staff.userId,
      subjectTenantId: tenantId,
      sessionId: actor.sessionId,
      ...requestContext,
      metadata: { doctorId: doctor.id, staffId: doctor.staffId, ...target },
    });
  }

  private createdRecord(result: CreateDoctorResult): DoctorRecord {
    if (result.kind === 'created') return result.doctor;
    if (result.kind === 'tenant-inactive') throw new DoctorTenantUnavailableError();
    if (result.kind === 'staff-not-found') throw new DoctorStaffNotFoundError();
    if (result.kind === 'staff-ineligible') throw new DoctorStaffIneligibleError();
    if (result.kind === 'already-exists') throw new DoctorAlreadyExistsError();
    throw new DoctorAssignmentTargetNotFoundError('catalog');
  }

  private changedRecord(
    result: DoctorMutationResult,
    target?: 'department' | 'specialty',
  ): DoctorRecord {
    if (result.kind === 'changed') return result.doctor;
    if (result.kind === 'tenant-inactive') throw new DoctorTenantUnavailableError();
    if (result.kind === 'not-found') throw new DoctorNotFoundError();
    if (result.kind === 'doctor-deactivated') throw new DoctorLifecycleConflictError();
    if (result.kind === 'assignment-target-not-found') {
      throw new DoctorAssignmentTargetNotFoundError(target ?? 'catalog');
    }
    if (result.kind === 'assignment-conflict') {
      throw new DoctorAssignmentConflictError(target ?? 'department');
    }
    if (result.kind === 'assignment-not-found') {
      throw new DoctorAssignmentNotFoundError(target ?? 'department');
    }
    throw new DoctorLifecycleConflictError();
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

  private id(id: string): string {
    const parsed = doctorIdSchema.safeParse(id);
    if (!parsed.success) throw new DoctorIdInvalidError();
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
    if (status === StaffStatus.SUSPENDED) return PlatformAuditEventType.DOCTOR_SUSPENDED;
    if (status === StaffStatus.ACTIVE) return PlatformAuditEventType.DOCTOR_ACTIVATED;
    return PlatformAuditEventType.DOCTOR_DEACTIVATED;
  }

  private present(record: DoctorRecord): DoctorResponse {
    return {
      id: record.id,
      tenantId: record.tenantId,
      staffId: record.staffId,
      staff: {
        id: record.staff.id,
        displayName: record.staff.displayName,
        status: record.staff.status,
      },
      professionalDisplayName: record.professionalDisplayName,
      status: record.status,
      operationallyActive:
        record.tenant.status === TenantStatus.ACTIVE &&
        record.staff.status === StaffStatus.ACTIVE &&
        record.status === StaffStatus.ACTIVE,
      departments: record.departmentAssignments.map(({ createdAt, department }) => ({
        ...department,
        assignedAt: createdAt,
      })),
      specialties: record.specialtyAssignments.map(({ createdAt, specialty }) => ({
        ...specialty,
        assignedAt: createdAt,
      })),
      statusChangedAt: record.statusChangedAt,
      suspendedAt: record.suspendedAt,
      deactivatedAt: record.deactivatedAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
