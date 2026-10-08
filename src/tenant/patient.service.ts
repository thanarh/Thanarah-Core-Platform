import { Inject, Injectable } from '@nestjs/common';
import { PlatformAuditEventType } from '@prisma/client';
import { z } from 'zod';
import type { AuthenticatedPlatformUser } from '../auth/auth.types';
import { PlatformAuditService } from '../platform-security/platform-audit.service';
import type { TrustedSecurityContext } from '../platform-security/platform-security.types';
import { TenantContextInvalidError, TenantContextRequiredError } from './tenant-context.contract';
import type { TrustedTenantContext } from './tenant-context.contract';
import { tenantIdSchema } from './tenant.dto';
import {
  createPatientSchema,
  listPatientsQuerySchema,
  MAX_PATIENT_LIST_OFFSET,
  patientIdSchema,
  patientNumberSchema,
  updatePatientSchema,
  type CreatePatientInput,
  type ListPatientsQuery,
  type UpdatePatientInput,
} from './patient.dto';
import {
  PatientIdInvalidError,
  PatientInputValidationError,
  PatientLifecycleConflictError,
  PatientNotFoundError,
  PatientNumberConflictError,
  PatientPossibleDuplicateError,
} from './patient.errors';
import { type PatientRepository, PATIENT_REPOSITORY } from './patient.repository';
import {
  PatientStatus,
  type PatientDirectoryRecord,
  type PatientDuplicateIdentity,
  type PatientRecord,
} from './patient.model';

export type PatientAuditContext = Pick<
  TrustedSecurityContext,
  'requestId' | 'ipAddress' | 'userAgent'
>;

export type PatientResponse = Omit<PatientRecord, 'dateOfBirth'> & {
  dateOfBirth: string | null;
};

export interface PatientListResponse {
  items: PatientDirectoryRecord[];
  limit: number;
  offset: number;
  total: number;
  hasNext: boolean;
}

const PATIENT_MUTABLE_FIELDS = [
  'patientNumber',
  'firstName',
  'middleName',
  'lastName',
  'preferredName',
  'dateOfBirth',
  'gender',
  'phone',
  'email',
  'nationalId',
  'address',
] as const;

const PATIENT_DUPLICATE_FIELDS = [
  'firstName',
  'middleName',
  'lastName',
  'dateOfBirth',
  'phone',
  'email',
] as const;

@Injectable()
export class PatientService {
  constructor(
    @Inject(PATIENT_REPOSITORY)
    private readonly patients: PatientRepository,
    private readonly audit: PlatformAuditService,
  ) {}

  async create(
    context: TrustedTenantContext,
    input: CreatePatientInput,
    actor: AuthenticatedPlatformUser,
    requestContext: PatientAuditContext = {},
  ): Promise<PatientResponse> {
    const tenantId = this.trustedTenantId(context);
    this.assertActor(context, actor);
    const parsed = createPatientSchema.safeParse(input);
    if (!parsed.success) throw new PatientInputValidationError();

    const existingNumber = await this.patients.findByPatientNumber(
      context,
      parsed.data.patientNumber,
    );
    if (existingNumber) throw new PatientNumberConflictError();
    if (
      await this.patients.findPotentialDuplicates(context, toPatientDuplicateIdentity(parsed.data))
    ) {
      throw new PatientPossibleDuplicateError();
    }

    const record = this.changedRecord(await this.patients.create(context, parsed.data));
    await this.audit.recordAudit({
      eventType: PlatformAuditEventType.PATIENT_CREATED,
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      subjectTenantId: tenantId,
      ...requestContext,
      metadata: {
        targetType: 'PATIENT',
        targetId: record.id,
        action: 'created',
        status: record.status,
      },
    });
    return this.present(record);
  }

  async list(
    context: TrustedTenantContext,
    query: ListPatientsQuery,
  ): Promise<PatientListResponse> {
    this.trustedTenantId(context);
    const parsed = listPatientsQuerySchema.safeParse(query);
    if (!parsed.success) throw new PatientInputValidationError();
    const { limit, offset } = parsed.data;
    const { items, total } = await this.patients.list(context, parsed.data);
    const nextOffset = offset + limit;
    return {
      items: items.map((record) => this.presentDirectory(record)),
      limit,
      offset,
      total,
      hasNext: nextOffset <= MAX_PATIENT_LIST_OFFSET && nextOffset < total,
    };
  }

  async findById(context: TrustedTenantContext, patientId: string): Promise<PatientResponse> {
    this.trustedTenantId(context);
    const id = this.patientId(patientId);
    const record = await this.patients.findByIdForTenant(context, id);
    if (!record) throw new PatientNotFoundError();
    return this.present(record);
  }

  async findByPatientNumber(
    context: TrustedTenantContext,
    patientNumber: string,
  ): Promise<PatientResponse> {
    this.trustedTenantId(context);
    const parsed = patientNumberSchema.safeParse(patientNumber);
    if (!parsed.success) throw new PatientInputValidationError();
    const record = await this.patients.findByPatientNumber(context, parsed.data);
    if (!record) throw new PatientNotFoundError();
    return this.present(record);
  }

  async update(
    context: TrustedTenantContext,
    patientId: string,
    input: UpdatePatientInput,
    actor: AuthenticatedPlatformUser,
    requestContext: PatientAuditContext = {},
  ): Promise<PatientResponse> {
    const tenantId = this.trustedTenantId(context);
    this.assertActor(context, actor);
    const id = this.patientId(patientId);
    const parsed = updatePatientSchema.safeParse(input);
    if (!parsed.success) throw new PatientInputValidationError();

    if (PATIENT_DUPLICATE_FIELDS.some((field) => parsed.data[field] !== undefined)) {
      const current = await this.patients.findByIdForTenant(context, id);
      if (!current) throw new PatientNotFoundError();
      const candidate = { ...current, ...parsed.data };
      if (
        await this.patients.findPotentialDuplicates(
          context,
          toPatientDuplicateIdentity(candidate),
          id,
        )
      ) {
        throw new PatientPossibleDuplicateError();
      }
    }

    const record = this.changedRecord(await this.patients.update(context, id, parsed.data));
    const changedFields = PATIENT_MUTABLE_FIELDS.filter(
      (field) => parsed.data[field] !== undefined,
    ).join(',');
    await this.audit.recordAudit({
      eventType: PlatformAuditEventType.PATIENT_UPDATED,
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      subjectTenantId: tenantId,
      ...requestContext,
      metadata: {
        targetType: 'PATIENT',
        targetId: record.id,
        action: 'updated',
        changedFields,
      },
    });
    return this.present(record);
  }

  activate(
    context: TrustedTenantContext,
    patientId: string,
    actor: AuthenticatedPlatformUser,
    requestContext: PatientAuditContext = {},
  ): Promise<PatientResponse> {
    return this.transition(context, patientId, PatientStatus.ACTIVE, actor, requestContext);
  }

  deactivate(
    context: TrustedTenantContext,
    patientId: string,
    actor: AuthenticatedPlatformUser,
    requestContext: PatientAuditContext = {},
  ): Promise<PatientResponse> {
    return this.transition(context, patientId, PatientStatus.INACTIVE, actor, requestContext);
  }

  private async transition(
    context: TrustedTenantContext,
    patientId: string,
    nextStatus: PatientStatus,
    actor: AuthenticatedPlatformUser,
    requestContext: PatientAuditContext,
  ): Promise<PatientResponse> {
    const tenantId = this.trustedTenantId(context);
    this.assertActor(context, actor);
    const id = this.patientId(patientId);
    const current = await this.patients.findByIdForTenant(context, id);
    if (!current) throw new PatientNotFoundError();
    if (current.status === nextStatus) return this.present(current);
    if (!this.canTransition(current.status, nextStatus)) {
      throw new PatientLifecycleConflictError();
    }

    const changedAt = new Date();
    const result = await this.patients.changeStatusIfCurrent(
      context,
      id,
      current.status,
      nextStatus,
      changedAt,
    );
    if (result.kind === 'patient-number-conflict') throw new PatientNumberConflictError();
    if (result.kind === 'not-found') throw new PatientNotFoundError();
    if (result.kind === 'not-changed') {
      const latest = await this.patients.findByIdForTenant(context, id);
      if (!latest) throw new PatientNotFoundError();
      if (latest.status === nextStatus) return this.present(latest);
      throw new PatientLifecycleConflictError();
    }

    await this.audit.recordAudit({
      eventType: PlatformAuditEventType.PATIENT_STATUS_CHANGED,
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      subjectTenantId: tenantId,
      ...requestContext,
      metadata: {
        targetType: 'PATIENT',
        targetId: result.record.id,
        action: nextStatus === PatientStatus.ACTIVE ? 'activated' : 'deactivated',
        fromStatus: current.status,
        toStatus: result.record.status,
      },
    });
    return this.present(result.record);
  }

  private changedRecord(result: Awaited<ReturnType<PatientRepository['create']>>): PatientRecord {
    if (result.kind === 'changed') return result.record;
    if (result.kind === 'not-found') throw new PatientNotFoundError();
    if (result.kind === 'patient-number-conflict') throw new PatientNumberConflictError();
    throw new PatientLifecycleConflictError();
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

  private patientId(patientId: string): string {
    const parsed = patientIdSchema.safeParse(patientId);
    if (!parsed.success) throw new PatientIdInvalidError();
    return parsed.data;
  }

  private canTransition(current: PatientStatus, next: PatientStatus): boolean {
    return (
      (current === PatientStatus.ACTIVE && next === PatientStatus.INACTIVE) ||
      (current === PatientStatus.INACTIVE && next === PatientStatus.ACTIVE)
    );
  }

  private present(record: PatientRecord): PatientResponse {
    return {
      ...record,
      dateOfBirth: record.dateOfBirth?.toISOString().slice(0, 10) ?? null,
    };
  }

  private presentDirectory(record: PatientDirectoryRecord): PatientDirectoryRecord {
    return {
      id: record.id,
      patientNumber: record.patientNumber,
      firstName: record.firstName,
      middleName: record.middleName,
      lastName: record.lastName,
      preferredName: record.preferredName,
      phone: record.phone,
      email: record.email,
      status: record.status,
    };
  }
}

function toPatientDuplicateIdentity(
  patient: Pick<PatientRecord, 'firstName' | 'lastName'> &
    Partial<Pick<PatientRecord, 'middleName' | 'dateOfBirth' | 'phone' | 'email'>>,
): PatientDuplicateIdentity {
  return {
    firstName: patient.firstName,
    middleName: patient.middleName ?? null,
    lastName: patient.lastName,
    dateOfBirth: patient.dateOfBirth ?? null,
    phone: patient.phone ?? null,
    email: patient.email ?? null,
  };
}
