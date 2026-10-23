import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PlatformAuditEventType } from '@prisma/client';
import type { AuthenticatedPlatformUser } from '../auth/auth.types';
import { PlatformAuditService } from '../platform-security/platform-audit.service';
import { AppointmentService } from './appointment.service';
import { AppointmentStatus } from './appointment.model';
import { BranchService } from './branch.service';
import { DoctorService } from './doctor.service';
import { FacilityService } from './facility.service';
import { PatientService } from './patient.service';
import { ServiceCatalogService } from './service-catalog.service';
import {
  cancelEncounterSchema,
  completeEncounterSchema,
  createEncounterAmendmentSchema,
  createDirectEncounterSchema,
  createEncounterFromAppointmentSchema,
  encounterEffectiveTimeZonesQuerySchema,
  encounterIdSchema,
  finalizeEncounterAmendmentSchema,
  listEncountersQuerySchema,
  replaceEncounterDiagnosesSchema,
  replaceEncounterServiceRecordsSchema,
  updateEncounterAmendmentSchema,
  updateEncounterSchema,
} from './encounter.dto';
import type {
  CancelEncounterInput,
  CompleteEncounterInput,
  CreateEncounterAmendmentInput,
  CreateDirectEncounterInput,
  CreateEncounterFromAppointmentInput,
  EncounterClinicalPatch,
  EncounterEffectiveTimeZonesQuery,
  FinalizeEncounterAmendmentInput,
  ListEncountersQuery,
  ReplaceEncounterDiagnosesInput,
  ReplaceEncounterServiceRecordsInput,
  UpdateEncounterAmendmentInput,
  UpdateEncounterInput,
} from './encounter.dto';
import {
  EncounterAppointmentConflictError,
  EncounterHistoryLimitError,
  EncounterIdempotencyConflictError,
  EncounterIdempotencyInProgressError,
  EncounterInputValidationError,
  EncounterIdempotencyReviewError,
  EncounterNotFoundError,
  EncounterReferenceInvalidError,
  EncounterScopeForbiddenError,
  EncounterStateConflictError,
  EncounterTimeZoneUnavailableError,
  EncounterVersionConflictError,
} from './encounter.errors';
import { EncounterStatus } from './encounter.model';
import type {
  EncounterAccessScope,
  EncounterAmendment,
  EncounterClinicalRecord,
  EncounterDiagnosis,
  EncounterHistoryAction,
  EncounterHistoryEvent,
  EncounterListFilter,
  EncounterListResponse,
  EncounterRecord,
  EncounterResponse,
  EncounterSummary,
  EncounterServiceRecord,
  EncounterServiceStatus,
  PatientEncounterHistoryResponse,
} from './encounter.model';
import type { EncounterRepository } from './encounter.repository';
import { ENCOUNTER_REPOSITORY } from './tenant-encounter.storage';
import type { TrustedTenantContext } from './tenant-context.contract';
import { TenantAuthorizationService } from './tenant-authorization.service';
import { TenantStaffScopeService } from './tenant-staff-scope.service';
import { FacilitySchedulingPolicyService } from './appointment-scheduling-policy.service';
import { localDateRangeToUtc } from './appointment-timezone';
import type { CreatePlatformAuditInput } from '../platform-security/platform-security.types';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

const MAX_ENCOUNTER_HISTORY_EVENTS = 5_000;

interface EncounterIdempotencyDescriptor {
  operationId: string;
  keyHash: string;
  fingerprint: string;
  route: string;
}

type EncounterCreateIdempotencyDescriptor = EncounterIdempotencyDescriptor & {
  resourceId: string;
};

export interface EncounterAuditRequestContext {
  requestId?: string;
  sessionId?: string;
  ipAddress?: string;
  userAgent?: string;
  idempotencyKey?: string;
}

@Injectable()
export class EncounterService {
  private readonly logger = new Logger(EncounterService.name);

  constructor(
    @Inject(ENCOUNTER_REPOSITORY)
    private readonly encounters: EncounterRepository,
    private readonly appointments: AppointmentService,
    private readonly patients: PatientService,
    private readonly doctors: DoctorService,
    private readonly services: ServiceCatalogService,
    private readonly facilities: FacilityService,
    private readonly branches: BranchService,
    private readonly staffScopes: TenantStaffScopeService,
    private readonly schedulingPolicies: FacilitySchedulingPolicyService,
    private readonly authorization: TenantAuthorizationService,
    private readonly audit: PlatformAuditService,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  async createFromAppointment(
    context: TrustedTenantContext,
    input: CreateEncounterFromAppointmentInput,
    actor: AuthenticatedPlatformUser,
    requestContext: EncounterAuditRequestContext = {},
  ): Promise<EncounterResponse> {
    this.assertActor(context, actor);
    await this.authorization.authorize(context, 'tenant.encounters.create');
    await this.authorization.authorize(context, 'tenant.appointments.read');
    const parsed = createEncounterFromAppointmentSchema.safeParse(input);
    if (!parsed.success) throw new EncounterInputValidationError();

    const appointment = await this.reference(() =>
      this.appointments.findById(context, parsed.data.appointmentId),
    );
    if (appointment.status !== AppointmentStatus.SCHEDULED) {
      throw new EncounterReferenceInvalidError();
    }
    await this.assertLocationScope(context, appointment.facilityId, appointment.branchId);
    await this.validateReferences(context, {
      patientId: appointment.patientId,
      doctorId: appointment.doctorId,
      facilityId: appointment.facilityId,
      branchId: appointment.branchId,
    });

    const idempotency = this.createIdempotency(
      context,
      actor,
      'from-appointment',
      requestContext.idempotencyKey,
      { appointmentId: appointment.id },
    );
    if (idempotency) {
      const existing = await this.encounters.findById(context, idempotency.resourceId);
      if (existing) {
        if (
          existing.createdBy !== actor.userId ||
          existing.appointmentId !== appointment.id ||
          existing.patientId !== appointment.patientId ||
          existing.doctorId !== appointment.doctorId ||
          existing.facilityId !== appointment.facilityId ||
          existing.branchId !== appointment.branchId
        ) {
          throw new EncounterIdempotencyConflictError();
        }
        await this.assertCreationReplay(context, actor, existing, idempotency);
        await this.recordAudit(
          context,
          actor,
          existing,
          PlatformAuditEventType.ENCOUNTER_CREATED,
          'created',
          ['appointmentId', 'patientId', 'doctorId', 'facilityId', 'branchId'],
          requestContext,
          idempotency,
        );
        return this.present(existing);
      }
    }
    if (await this.encounters.findActiveByAppointment(context, appointment.id)) {
      throw new EncounterAppointmentConflictError();
    }

    const record = this.newRecord(
      actor,
      {
        appointmentId: appointment.id,
        patientId: appointment.patientId,
        doctorId: appointment.doctorId,
        facilityId: appointment.facilityId,
        branchId: appointment.branchId,
      },
      new Date(),
      idempotency?.resourceId,
    );
    if (idempotency) record.history[0]!.id = idempotency.operationId;
    await this.prepareOperation(
      context,
      actor,
      record,
      PlatformAuditEventType.ENCOUNTER_CREATED,
      'created',
      ['appointmentId', 'patientId', 'doctorId', 'facilityId', 'branchId'],
      idempotency ?? undefined,
    );
    const created = await this.encounters.create(context, record);
    await this.recordAudit(
      context,
      actor,
      created,
      PlatformAuditEventType.ENCOUNTER_CREATED,
      'created',
      ['appointmentId', 'patientId', 'doctorId', 'facilityId', 'branchId'],
      requestContext,
      idempotency ?? undefined,
    );
    return this.present(created);
  }

  async createDirect(
    context: TrustedTenantContext,
    input: CreateDirectEncounterInput,
    actor: AuthenticatedPlatformUser,
    requestContext: EncounterAuditRequestContext = {},
  ): Promise<EncounterResponse> {
    this.assertActor(context, actor);
    await this.authorization.authorize(context, 'tenant.encounters.create');
    await this.authorization.authorize(context, 'tenant.encounters.create.direct');
    const parsed = createDirectEncounterSchema.safeParse(input);
    if (!parsed.success) throw new EncounterInputValidationError();

    const references = {
      patientId: parsed.data.patientId,
      doctorId: parsed.data.doctorId,
      facilityId: parsed.data.facilityId,
      branchId: parsed.data.branchId ?? null,
    };
    await this.assertLocationScope(context, references.facilityId, references.branchId);
    await this.validateReferences(context, references);
    const idempotency = this.createIdempotency(
      context,
      actor,
      'direct',
      requestContext.idempotencyKey,
      references,
    );
    if (idempotency) {
      const existing = await this.encounters.findById(context, idempotency.resourceId);
      if (existing) {
        if (
          existing.createdBy !== actor.userId ||
          existing.appointmentId !== null ||
          existing.patientId !== references.patientId ||
          existing.doctorId !== references.doctorId ||
          existing.facilityId !== references.facilityId ||
          existing.branchId !== references.branchId
        ) {
          throw new EncounterIdempotencyConflictError();
        }
        await this.assertCreationReplay(context, actor, existing, idempotency);
        await this.recordAudit(
          context,
          actor,
          existing,
          PlatformAuditEventType.ENCOUNTER_CREATED,
          'created_direct',
          ['patientId', 'doctorId', 'facilityId', 'branchId'],
          requestContext,
          idempotency,
        );
        return this.present(existing);
      }
    }
    const record = this.newRecord(
      actor,
      { appointmentId: null, ...references },
      new Date(),
      idempotency?.resourceId,
    );
    if (idempotency) record.history[0]!.id = idempotency.operationId;
    await this.prepareOperation(
      context,
      actor,
      record,
      PlatformAuditEventType.ENCOUNTER_CREATED,
      'created_direct',
      ['patientId', 'doctorId', 'facilityId', 'branchId'],
      idempotency ?? undefined,
    );
    const created = await this.encounters.create(context, record);
    await this.recordAudit(
      context,
      actor,
      created,
      PlatformAuditEventType.ENCOUNTER_CREATED,
      'created_direct',
      ['patientId', 'doctorId', 'facilityId', 'branchId'],
      requestContext,
      idempotency ?? undefined,
    );
    return this.present(created);
  }

  async list(
    context: TrustedTenantContext,
    query: ListEncountersQuery,
  ): Promise<EncounterListResponse> {
    await this.authorization.authorize(context, 'tenant.encounters.read');
    const parsed = listEncountersQuerySchema.safeParse(query);
    if (!parsed.success) throw new EncounterInputValidationError();
    if (parsed.data.patientId) {
      await this.authorization.authorize(context, 'tenant.encounters.patient-history.read');
    }
    const result = await this.listRecords(context, parsed.data);
    return { ...result, items: result.items.map((record) => this.presentSummary(record)) };
  }

  async patientHistory(
    context: TrustedTenantContext,
    patientId: string,
    query: ListEncountersQuery,
  ): Promise<PatientEncounterHistoryResponse> {
    await this.authorization.authorize(context, 'tenant.encounters.patient-history.read');
    await this.authorizeEncounterDetailReads(context);
    const parsedPatientId = encounterIdSchema.safeParse(patientId);
    if (!parsedPatientId.success) throw new EncounterInputValidationError();
    const parsed = listEncountersQuerySchema.safeParse(query);
    if (
      !parsed.success ||
      (parsed.data.patientId && parsed.data.patientId !== parsedPatientId.data)
    ) {
      throw new EncounterInputValidationError();
    }
    const result = await this.listRecords(context, {
      ...parsed.data,
      patientId: parsedPatientId.data,
    });
    return { ...result, items: result.items.map((record) => this.present(record)) };
  }

  async findById(context: TrustedTenantContext, encounterId: string): Promise<EncounterResponse> {
    await this.authorization.authorize(context, 'tenant.encounters.read');
    await this.authorizeEncounterDetailReads(context);
    const record = await this.findInScope(context, encounterId);
    return this.present(record);
  }

  async updateClinical(
    context: TrustedTenantContext,
    encounterId: string,
    input: UpdateEncounterInput,
    actor: AuthenticatedPlatformUser,
    requestContext: EncounterAuditRequestContext = {},
  ): Promise<EncounterResponse> {
    this.assertActor(context, actor);
    await this.authorization.authorize(context, 'tenant.encounters.read');
    await this.authorizeEncounterDetailReads(context);
    await this.authorization.authorize(context, 'tenant.encounters.clinical.write');
    const parsedId = encounterIdSchema.safeParse(encounterId);
    const parsed = updateEncounterSchema.safeParse(input);
    if (!parsedId.success || !parsed.success) throw new EncounterInputValidationError();
    const current = await this.findInScope(context, parsedId.data);
    const idempotency = this.mutationIdempotency(
      context,
      actor,
      'clinical_updated',
      current.id,
      requestContext.idempotencyKey,
      parsed.data,
    );
    const replay = await this.replayMutation(
      context,
      actor,
      requestContext,
      current,
      idempotency,
      PlatformAuditEventType.ENCOUNTER_CLINICAL_UPDATED,
    );
    if (replay) return replay;
    if (current.status !== EncounterStatus.DRAFT) throw new EncounterStateConflictError();
    if (current.version !== parsed.data.expectedVersion) throw new EncounterVersionConflictError();
    if (current.history.length >= MAX_ENCOUNTER_HISTORY_EVENTS) {
      throw new EncounterHistoryLimitError();
    }

    const changedFields = changedClinicalFields(parsed.data.clinical);
    const nextClinical = applyClinicalPatch(current.clinical, parsed.data.clinical);
    const occurredAt = new Date();
    const event = this.historyEvent(
      actor,
      'CLINICAL_UPDATED',
      occurredAt,
      current.version,
      changedFields,
    );
    await this.prepareOperation(
      context,
      actor,
      { ...current, history: [...current.history, event] },
      PlatformAuditEventType.ENCOUNTER_CLINICAL_UPDATED,
      'clinical_updated',
      changedFields,
      idempotency,
    );
    const updated = await this.encounters.update(
      context,
      current.id,
      current.version,
      EncounterStatus.DRAFT,
      { clinical: nextClinical, updatedAt: occurredAt, updatedBy: actor.userId },
      event,
    );
    if (!updated) {
      await this.markOperationNotApplied(event.id, context.tenantId);
      await this.throwWriteConflict(context, current.id, current.version);
    }
    await this.recordAudit(
      context,
      actor,
      updated!,
      PlatformAuditEventType.ENCOUNTER_CLINICAL_UPDATED,
      'clinical_updated',
      changedFields,
      requestContext,
      idempotency,
    );
    return this.present(updated!);
  }

  async replaceDiagnoses(
    context: TrustedTenantContext,
    encounterId: string,
    input: ReplaceEncounterDiagnosesInput,
    actor: AuthenticatedPlatformUser,
    requestContext: EncounterAuditRequestContext = {},
  ): Promise<EncounterResponse> {
    this.assertActor(context, actor);
    await this.authorization.authorize(context, 'tenant.encounters.read');
    await this.authorizeEncounterDetailReads(context);
    await this.authorization.authorize(context, 'tenant.encounters.diagnoses.write');
    const parsedId = encounterIdSchema.safeParse(encounterId);
    const parsed = replaceEncounterDiagnosesSchema.safeParse(input);
    if (!parsedId.success || !parsed.success) throw new EncounterInputValidationError();
    const current = await this.findInScope(context, parsedId.data);
    const idempotency = this.mutationIdempotency(
      context,
      actor,
      'diagnoses_updated',
      current.id,
      requestContext.idempotencyKey,
      parsed.data,
    );
    const replay = await this.replayMutation(
      context,
      actor,
      requestContext,
      current,
      idempotency,
      PlatformAuditEventType.ENCOUNTER_CLINICAL_UPDATED,
    );
    if (replay) return replay;
    if (current.status !== EncounterStatus.DRAFT) throw new EncounterStateConflictError();
    this.assertExpectedVersion(current, parsed.data.expectedVersion);
    this.assertHistoryCapacity(current);

    const occurredAt = new Date();
    const diagnoses = buildDiagnosisRecords(
      parsed.data.diagnoses,
      current.diagnoses,
      actor.userId,
      occurredAt,
    );
    const event = this.historyEvent(actor, 'DIAGNOSES_UPDATED', occurredAt, current.version, [
      'diagnoses',
    ]);
    await this.prepareOperation(
      context,
      actor,
      { ...current, history: [...current.history, event] },
      PlatformAuditEventType.ENCOUNTER_CLINICAL_UPDATED,
      'diagnoses_updated',
      ['diagnoses'],
      idempotency,
    );
    const updated = await this.encounters.update(
      context,
      current.id,
      current.version,
      EncounterStatus.DRAFT,
      { diagnoses, updatedAt: occurredAt, updatedBy: actor.userId },
      event,
    );
    if (!updated) {
      await this.markOperationNotApplied(event.id, context.tenantId);
      await this.throwWriteConflict(context, current.id, current.version);
    }
    await this.recordAudit(
      context,
      actor,
      updated!,
      PlatformAuditEventType.ENCOUNTER_CLINICAL_UPDATED,
      'diagnoses_updated',
      ['diagnoses'],
      requestContext,
      idempotency,
    );
    return this.present(updated!);
  }

  async replaceServiceRecords(
    context: TrustedTenantContext,
    encounterId: string,
    input: ReplaceEncounterServiceRecordsInput,
    actor: AuthenticatedPlatformUser,
    requestContext: EncounterAuditRequestContext = {},
  ): Promise<EncounterResponse> {
    this.assertActor(context, actor);
    await this.authorization.authorize(context, 'tenant.encounters.read');
    await this.authorizeEncounterDetailReads(context);
    await this.authorization.authorize(context, 'tenant.encounters.services.write');
    const parsedId = encounterIdSchema.safeParse(encounterId);
    const parsed = replaceEncounterServiceRecordsSchema.safeParse(input);
    if (!parsedId.success || !parsed.success) throw new EncounterInputValidationError();
    const current = await this.findInScope(context, parsedId.data);
    const idempotency = this.mutationIdempotency(
      context,
      actor,
      'service_records_updated',
      current.id,
      requestContext.idempotencyKey,
      parsed.data,
    );
    const replay = await this.replayMutation(
      context,
      actor,
      requestContext,
      current,
      idempotency,
      PlatformAuditEventType.ENCOUNTER_CLINICAL_UPDATED,
    );
    if (replay) return replay;
    if (current.status !== EncounterStatus.DRAFT) throw new EncounterStateConflictError();
    this.assertExpectedVersion(current, parsed.data.expectedVersion);
    this.assertHistoryCapacity(current);

    const occurredAt = new Date();
    const serviceRecords = await this.buildServiceRecords(
      context,
      current,
      parsed.data.serviceRecords,
      current.serviceRecords,
      actor.userId,
      occurredAt,
    );
    const event = this.historyEvent(actor, 'SERVICE_RECORDS_UPDATED', occurredAt, current.version, [
      'serviceRecords',
    ]);
    await this.prepareOperation(
      context,
      actor,
      { ...current, history: [...current.history, event] },
      PlatformAuditEventType.ENCOUNTER_CLINICAL_UPDATED,
      'service_records_updated',
      ['serviceRecords'],
      idempotency,
    );
    const updated = await this.encounters.update(
      context,
      current.id,
      current.version,
      EncounterStatus.DRAFT,
      { serviceRecords, updatedAt: occurredAt, updatedBy: actor.userId },
      event,
    );
    if (!updated) {
      await this.markOperationNotApplied(event.id, context.tenantId);
      await this.throwWriteConflict(context, current.id, current.version);
    }
    await this.recordAudit(
      context,
      actor,
      updated!,
      PlatformAuditEventType.ENCOUNTER_CLINICAL_UPDATED,
      'service_records_updated',
      ['serviceRecords'],
      requestContext,
      idempotency,
    );
    return this.present(updated!);
  }

  async createEncounterAmendment(
    context: TrustedTenantContext,
    encounterId: string,
    input: CreateEncounterAmendmentInput,
    actor: AuthenticatedPlatformUser,
    requestContext: EncounterAuditRequestContext = {},
  ): Promise<EncounterResponse> {
    this.assertActor(context, actor);
    await this.authorization.authorize(context, 'tenant.encounters.read');
    await this.authorizeEncounterDetailReads(context);
    await this.authorization.authorize(context, 'tenant.encounters.amendments.create');
    const parsedId = encounterIdSchema.safeParse(encounterId);
    const parsed = createEncounterAmendmentSchema.safeParse(input);
    if (!parsedId.success || !parsed.success) throw new EncounterInputValidationError();
    const current = await this.findInScope(context, parsedId.data);
    const idempotency = this.mutationIdempotency(
      context,
      actor,
      'amendment_opened',
      current.id,
      requestContext.idempotencyKey,
      parsed.data,
    );
    const replay = await this.replayMutation(
      context,
      actor,
      requestContext,
      current,
      idempotency,
      PlatformAuditEventType.ENCOUNTER_CLINICAL_UPDATED,
    );
    if (replay) return replay;
    if (current.status !== EncounterStatus.COMPLETED) throw new EncounterStateConflictError();
    this.assertExpectedVersion(current, parsed.data.expectedVersion);
    this.assertHistoryCapacity(current);
    const amendments = current.amendments ?? [];
    if (amendments.at(-1)?.status === 'OPEN' || amendments.length >= 100) {
      throw new EncounterStateConflictError();
    }

    const occurredAt = new Date();
    const snapshot = effectiveClinicalSnapshot(current);
    const amendment: EncounterAmendment = {
      id: randomUUID(),
      reason: parsed.data.reason,
      status: 'OPEN',
      clinical: structuredClone(snapshot.clinical),
      diagnoses: structuredClone(snapshot.diagnoses),
      serviceRecords: structuredClone(snapshot.serviceRecords),
      createdAt: occurredAt,
      createdBy: actor.userId,
      finalizedAt: null,
      finalizedBy: null,
    };
    const event = this.historyEvent(actor, 'AMENDMENT_OPENED', occurredAt, current.version, [
      'amendment',
    ]);
    await this.prepareOperation(
      context,
      actor,
      { ...current, history: [...current.history, event] },
      PlatformAuditEventType.ENCOUNTER_CLINICAL_UPDATED,
      'amendment_opened',
      ['amendment'],
      idempotency,
    );
    const updated = await this.encounters.update(
      context,
      current.id,
      current.version,
      EncounterStatus.COMPLETED,
      {
        amendments: [...amendments, amendment],
        updatedAt: occurredAt,
        updatedBy: actor.userId,
      },
      event,
    );
    if (!updated) {
      await this.markOperationNotApplied(event.id, context.tenantId);
      await this.throwWriteConflict(context, current.id, current.version);
    }
    await this.recordAudit(
      context,
      actor,
      updated!,
      PlatformAuditEventType.ENCOUNTER_CLINICAL_UPDATED,
      'amendment_opened',
      ['amendment'],
      requestContext,
      idempotency,
    );
    return this.present(updated!);
  }

  async updateEncounterAmendment(
    context: TrustedTenantContext,
    encounterId: string,
    amendmentId: string,
    input: UpdateEncounterAmendmentInput,
    actor: AuthenticatedPlatformUser,
    requestContext: EncounterAuditRequestContext = {},
  ): Promise<EncounterResponse> {
    this.assertActor(context, actor);
    await this.authorization.authorize(context, 'tenant.encounters.read');
    await this.authorizeEncounterDetailReads(context);
    await this.authorization.authorize(context, 'tenant.encounters.amendments.update');
    const parsedId = encounterIdSchema.safeParse(encounterId);
    const parsedAmendmentId = encounterIdSchema.safeParse(amendmentId);
    const parsed = updateEncounterAmendmentSchema.safeParse(input);
    if (!parsedId.success || !parsedAmendmentId.success || !parsed.success) {
      throw new EncounterInputValidationError();
    }
    if (parsed.data.clinical) {
      await this.authorization.authorize(context, 'tenant.encounters.clinical.write');
    }
    if (parsed.data.diagnoses) {
      await this.authorization.authorize(context, 'tenant.encounters.diagnoses.write');
    }
    if (parsed.data.serviceRecords) {
      await this.authorization.authorize(context, 'tenant.encounters.services.write');
    }
    const current = await this.findInScope(context, parsedId.data);
    const idempotency = this.mutationIdempotency(
      context,
      actor,
      'amendment_updated',
      current.id,
      requestContext.idempotencyKey,
      { amendmentId: parsedAmendmentId.data, input: parsed.data },
    );
    const replay = await this.replayMutation(
      context,
      actor,
      requestContext,
      current,
      idempotency,
      PlatformAuditEventType.ENCOUNTER_CLINICAL_UPDATED,
    );
    if (replay) return replay;
    if (current.status !== EncounterStatus.COMPLETED) throw new EncounterStateConflictError();
    this.assertExpectedVersion(current, parsed.data.expectedVersion);
    this.assertHistoryCapacity(current);
    const amendments = [...(current.amendments ?? [])];
    const amendment = amendments.at(-1);
    if (!amendment || amendment.id !== parsedAmendmentId.data || amendment.status !== 'OPEN') {
      throw new EncounterStateConflictError();
    }

    const occurredAt = new Date();
    const changedFields: string[] = [];
    if (parsed.data.clinical) {
      amendment.clinical = applyClinicalPatch(amendment.clinical, parsed.data.clinical);
      changedFields.push(
        ...changedClinicalFields(parsed.data.clinical).map((field) => `clinical.${field}`),
      );
    }
    if (parsed.data.diagnoses) {
      amendment.diagnoses = buildDiagnosisRecords(
        parsed.data.diagnoses,
        amendment.diagnoses,
        actor.userId,
        occurredAt,
      );
      changedFields.push('diagnoses');
    }
    if (parsed.data.serviceRecords) {
      amendment.serviceRecords = await this.buildServiceRecords(
        context,
        current,
        parsed.data.serviceRecords,
        amendment.serviceRecords,
        actor.userId,
        occurredAt,
        true,
      );
      changedFields.push('serviceRecords');
    }
    const event = this.historyEvent(actor, 'AMENDMENT_UPDATED', occurredAt, current.version, [
      'amendment',
      ...changedFields,
    ]);
    await this.prepareOperation(
      context,
      actor,
      { ...current, history: [...current.history, event] },
      PlatformAuditEventType.ENCOUNTER_CLINICAL_UPDATED,
      'amendment_updated',
      ['amendment', ...changedFields],
      idempotency,
    );
    const updated = await this.encounters.update(
      context,
      current.id,
      current.version,
      EncounterStatus.COMPLETED,
      { amendments, updatedAt: occurredAt, updatedBy: actor.userId },
      event,
    );
    if (!updated) {
      await this.markOperationNotApplied(event.id, context.tenantId);
      await this.throwWriteConflict(context, current.id, current.version);
    }
    await this.recordAudit(
      context,
      actor,
      updated!,
      PlatformAuditEventType.ENCOUNTER_CLINICAL_UPDATED,
      'amendment_updated',
      ['amendment', ...changedFields],
      requestContext,
      idempotency,
    );
    return this.present(updated!);
  }

  async finalizeEncounterAmendment(
    context: TrustedTenantContext,
    encounterId: string,
    amendmentId: string,
    input: FinalizeEncounterAmendmentInput,
    actor: AuthenticatedPlatformUser,
    requestContext: EncounterAuditRequestContext = {},
  ): Promise<EncounterResponse> {
    this.assertActor(context, actor);
    await this.authorization.authorize(context, 'tenant.encounters.read');
    await this.authorizeEncounterDetailReads(context);
    await this.authorization.authorize(context, 'tenant.encounters.amendments.finalize');
    const parsedId = encounterIdSchema.safeParse(encounterId);
    const parsedAmendmentId = encounterIdSchema.safeParse(amendmentId);
    const parsed = finalizeEncounterAmendmentSchema.safeParse(input);
    if (!parsedId.success || !parsedAmendmentId.success || !parsed.success) {
      throw new EncounterInputValidationError();
    }
    const current = await this.findInScope(context, parsedId.data);
    const idempotency = this.mutationIdempotency(
      context,
      actor,
      'amendment_finalized',
      current.id,
      requestContext.idempotencyKey,
      { amendmentId: parsedAmendmentId.data, input: parsed.data },
    );
    const replay = await this.replayMutation(
      context,
      actor,
      requestContext,
      current,
      idempotency,
      PlatformAuditEventType.ENCOUNTER_CLINICAL_UPDATED,
    );
    if (replay) return replay;
    if (current.status !== EncounterStatus.COMPLETED) throw new EncounterStateConflictError();
    this.assertExpectedVersion(current, parsed.data.expectedVersion);
    this.assertHistoryCapacity(current);
    const amendments = [...(current.amendments ?? [])];
    const amendment = amendments.at(-1);
    if (!amendment || amendment.id !== parsedAmendmentId.data || amendment.status !== 'OPEN') {
      throw new EncounterStateConflictError();
    }

    const occurredAt = new Date();
    amendment.status = 'FINALIZED';
    amendment.finalizedAt = occurredAt;
    amendment.finalizedBy = actor.userId;
    const event = this.historyEvent(actor, 'AMENDMENT_FINALIZED', occurredAt, current.version, [
      'amendment.status',
    ]);
    await this.prepareOperation(
      context,
      actor,
      { ...current, history: [...current.history, event] },
      PlatformAuditEventType.ENCOUNTER_CLINICAL_UPDATED,
      'amendment_finalized',
      ['amendment.status'],
      idempotency,
    );
    const updated = await this.encounters.update(
      context,
      current.id,
      current.version,
      EncounterStatus.COMPLETED,
      { amendments, updatedAt: occurredAt, updatedBy: actor.userId },
      event,
    );
    if (!updated) {
      await this.markOperationNotApplied(event.id, context.tenantId);
      await this.throwWriteConflict(context, current.id, current.version);
    }
    await this.recordAudit(
      context,
      actor,
      updated!,
      PlatformAuditEventType.ENCOUNTER_CLINICAL_UPDATED,
      'amendment_finalized',
      ['amendment.status'],
      requestContext,
      idempotency,
    );
    return this.present(updated!);
  }

  async complete(
    context: TrustedTenantContext,
    encounterId: string,
    input: CompleteEncounterInput,
    actor: AuthenticatedPlatformUser,
    requestContext: EncounterAuditRequestContext = {},
  ): Promise<EncounterResponse> {
    this.assertActor(context, actor);
    await this.authorization.authorize(context, 'tenant.encounters.read');
    await this.authorizeEncounterDetailReads(context);
    await this.authorization.authorize(context, 'tenant.encounters.complete');
    const parsedId = encounterIdSchema.safeParse(encounterId);
    const parsed = completeEncounterSchema.safeParse(input);
    if (!parsedId.success || !parsed.success) throw new EncounterInputValidationError();
    const current = await this.findInScope(context, parsedId.data);
    const idempotency = this.mutationIdempotency(
      context,
      actor,
      'completed',
      current.id,
      requestContext.idempotencyKey,
      parsed.data,
    );
    const replay = await this.replayMutation(
      context,
      actor,
      requestContext,
      current,
      idempotency,
      PlatformAuditEventType.ENCOUNTER_COMPLETED,
    );
    if (replay) return replay;
    if (current.status !== EncounterStatus.DRAFT) throw new EncounterStateConflictError();
    if (current.version !== parsed.data.expectedVersion) throw new EncounterVersionConflictError();
    if (current.history.length >= MAX_ENCOUNTER_HISTORY_EVENTS) {
      throw new EncounterHistoryLimitError();
    }

    const occurredAt = new Date();
    const event = this.historyEvent(actor, 'COMPLETED', occurredAt, current.version, ['status']);
    await this.prepareOperation(
      context,
      actor,
      { ...current, history: [...current.history, event] },
      PlatformAuditEventType.ENCOUNTER_COMPLETED,
      'completed',
      ['status'],
      idempotency,
    );
    const updated = await this.encounters.update(
      context,
      current.id,
      current.version,
      EncounterStatus.DRAFT,
      {
        status: EncounterStatus.COMPLETED,
        completedAt: occurredAt,
        completedBy: actor.userId,
        updatedAt: occurredAt,
        updatedBy: actor.userId,
      },
      event,
    );
    if (!updated) {
      await this.markOperationNotApplied(event.id, context.tenantId);
      await this.throwWriteConflict(context, current.id, current.version);
    }
    await this.recordAudit(
      context,
      actor,
      updated!,
      PlatformAuditEventType.ENCOUNTER_COMPLETED,
      'completed',
      ['status'],
      requestContext,
      idempotency,
    );
    return this.present(updated!);
  }

  async cancel(
    context: TrustedTenantContext,
    encounterId: string,
    input: CancelEncounterInput,
    actor: AuthenticatedPlatformUser,
    requestContext: EncounterAuditRequestContext = {},
  ): Promise<EncounterResponse> {
    this.assertActor(context, actor);
    await this.authorization.authorize(context, 'tenant.encounters.read');
    await this.authorizeEncounterDetailReads(context);
    await this.authorization.authorize(context, 'tenant.encounters.cancel');
    const parsedId = encounterIdSchema.safeParse(encounterId);
    const parsed = cancelEncounterSchema.safeParse(input);
    if (!parsedId.success || !parsed.success) throw new EncounterInputValidationError();
    const current = await this.findInScope(context, parsedId.data);
    const idempotency = this.mutationIdempotency(
      context,
      actor,
      'cancelled',
      current.id,
      requestContext.idempotencyKey,
      parsed.data,
    );
    const replay = await this.replayMutation(
      context,
      actor,
      requestContext,
      current,
      idempotency,
      PlatformAuditEventType.ENCOUNTER_CANCELLED,
    );
    if (replay) return replay;
    if (current.status !== EncounterStatus.DRAFT) throw new EncounterStateConflictError();
    if (current.version !== parsed.data.expectedVersion) throw new EncounterVersionConflictError();
    if (current.history.length >= MAX_ENCOUNTER_HISTORY_EVENTS) {
      throw new EncounterHistoryLimitError();
    }

    const occurredAt = new Date();
    const changedFields = parsed.data.reason ? ['status', 'cancellationReason'] : ['status'];
    const event = this.historyEvent(actor, 'CANCELLED', occurredAt, current.version, changedFields);
    await this.prepareOperation(
      context,
      actor,
      { ...current, history: [...current.history, event] },
      PlatformAuditEventType.ENCOUNTER_CANCELLED,
      'cancelled',
      changedFields,
      idempotency,
    );
    const updated = await this.encounters.update(
      context,
      current.id,
      current.version,
      EncounterStatus.DRAFT,
      {
        status: EncounterStatus.CANCELLED,
        cancelledAt: occurredAt,
        cancelledBy: actor.userId,
        cancellationReason: parsed.data.reason ?? null,
        updatedAt: occurredAt,
        updatedBy: actor.userId,
      },
      event,
    );
    if (!updated) {
      await this.markOperationNotApplied(event.id, context.tenantId);
      await this.throwWriteConflict(context, current.id, current.version);
    }
    await this.recordAudit(
      context,
      actor,
      updated!,
      PlatformAuditEventType.ENCOUNTER_CANCELLED,
      'cancelled',
      changedFields,
      requestContext,
      idempotency,
    );
    return this.present(updated!);
  }

  async history(
    context: TrustedTenantContext,
    encounterId: string,
  ): Promise<{
    items: EncounterHistoryEvent[];
  }> {
    await this.authorization.authorize(context, 'tenant.encounters.read');
    await this.authorization.authorize(context, 'tenant.encounters.history.read');
    const record = await this.findInScope(context, encounterId);
    const history = await this.encounters.history(context, record.id);
    if (!history) throw new EncounterNotFoundError();
    return { items: history };
  }

  async mutationStatus(
    context: TrustedTenantContext,
    encounterId: string,
    route: string,
    actor: AuthenticatedPlatformUser,
    key: string | undefined,
  ): Promise<{ status: 'NOT_FOUND' | 'RETRY_SAFE' | 'APPLIED' | 'REVIEW_REQUIRED' }> {
    this.assertActor(context, actor);
    await this.authorization.authorize(context, 'tenant.encounters.read');
    const allowedRoutes = new Set([
      'clinical_updated',
      'diagnoses_updated',
      'service_records_updated',
      'amendment_opened',
      'amendment_updated',
      'amendment_finalized',
      'completed',
      'cancelled',
    ]);
    if (!allowedRoutes.has(route) || key === undefined) {
      throw new EncounterInputValidationError();
    }
    const record = await this.findInScope(context, encounterId);
    const idempotency = this.mutationIdempotency(context, actor, route, record.id, key, null);
    if (!idempotency) throw new EncounterInputValidationError();
    let operation;
    try {
      operation = await this.prisma!.encounterOperation.findUnique({
        where: { id: idempotency.operationId },
      });
    } catch {
      throw new ServiceUnavailableException('Encounter operation tracking is unavailable');
    }
    if (!operation) return { status: 'NOT_FOUND' };
    const metadata = this.idempotencyMetadata(operation.auditMetadata);
    if (
      operation.tenantId !== context.tenantId ||
      operation.actorUserId !== actor.userId ||
      operation.resourceId !== record.id ||
      operation.historyEventId !== idempotency.operationId ||
      metadata?.idempotencyKeyHash !== idempotency.keyHash ||
      metadata?.idempotencyRoute !== route
    ) {
      return { status: 'NOT_FOUND' };
    }
    const event = record.history.find((item) => item.id === operation.historyEventId);
    if (operation.mutationState === 'NOT_APPLIED' && !event) {
      return { status: 'RETRY_SAFE' };
    }
    if (operation.mutationState === 'CONFIRMED' && event?.action === operation.operationType) {
      return { status: 'APPLIED' };
    }
    return { status: 'REVIEW_REQUIRED' };
  }

  async reconcileAudit(
    context: TrustedTenantContext,
    requestedLimit: unknown,
  ): Promise<{ items: Array<{ operationId: string; outcome: string }> }> {
    await this.authorization.authorize(context, 'tenant.encounters.audit.reconcile');
    const limit =
      typeof requestedLimit === 'number' && Number.isInteger(requestedLimit)
        ? Math.min(25, Math.max(1, requestedLimit))
        : 10;
    if (!this.prisma) return { items: [{ operationId: '', outcome: 'DEPENDENCY_UNAVAILABLE' }] };

    const claimTime = new Date();
    const staleClaimBefore = new Date(claimTime.getTime() - 60_000);
    let operations;
    try {
      operations = await this.prisma.encounterOperation.findMany({
        where: {
          tenantId: context.tenantId,
          auditDeliveryStatus: { in: ['PENDING', 'FAILED'] },
          attemptCount: { lt: 5 },
          OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lt: staleClaimBefore } }],
        },
        orderBy: { createdAt: 'asc' },
        take: limit,
      });
    } catch {
      return { items: [{ operationId: '', outcome: 'DEPENDENCY_UNAVAILABLE' }] };
    }
    const items: Array<{ operationId: string; outcome: string }> = [];
    for (const operation of operations) {
      const claim = await this.prisma.encounterOperation.updateMany({
        where: {
          id: operation.id,
          tenantId: context.tenantId,
          auditDeliveryStatus: operation.auditDeliveryStatus,
          attemptCount: operation.attemptCount,
          mutationState: operation.mutationState,
          lastAttemptAt: operation.lastAttemptAt,
          OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lt: staleClaimBefore } }],
        },
        data: { attemptCount: { increment: 1 }, lastAttemptAt: claimTime },
      });
      if (claim.count !== 1) {
        items.push({ operationId: operation.id, outcome: 'REQUIRES_OPERATOR_REVIEW' });
        continue;
      }
      const claimedAttempt = operation.attemptCount + 1;
      try {
        const record = await this.encounters.findById(context, operation.resourceId);
        if (!record) {
          await this.finishAmbiguousReconciliation(
            operation.id,
            claimedAttempt,
            'HISTORY_EVIDENCE_MISSING',
          );
          items.push({ operationId: operation.id, outcome: 'AMBIGUOUS_REQUIRES_REVIEW' });
          continue;
        }
        const event = record.history.find((candidate) => candidate.id === operation.historyEventId);
        const auditMetadata = operation.auditMetadata;
        if (!event) {
          await this.finishAmbiguousReconciliation(
            operation.id,
            claimedAttempt,
            'HISTORY_EVIDENCE_MISSING',
          );
          items.push({ operationId: operation.id, outcome: 'AMBIGUOUS_REQUIRES_REVIEW' });
          continue;
        }
        if (
          operation.resourceType !== 'encounter' ||
          operation.resourceId !== record.id ||
          !isPlainRecord(auditMetadata) ||
          auditMetadata.resourceType !== 'encounter' ||
          auditMetadata.encounterId !== record.id ||
          event.actorUserId !== operation.actorUserId ||
          event.action !== operation.operationType ||
          event.id !== operation.id ||
          event.toVersion !== event.fromVersion + 1
        ) {
          await this.finishReconciliation(operation.id, claimedAttempt, 'IDENTITY_MISMATCH');
          items.push({ operationId: operation.id, outcome: 'REQUIRES_OPERATOR_REVIEW' });
          continue;
        }
        const delivered = await this.audit.recordAudit({
          eventId: operation.historyEventId,
          eventType: operation.auditEventType as PlatformAuditEventType,
          actorUserId: operation.actorUserId ?? undefined,
          subjectTenantId: operation.tenantId,
          metadata: operation.auditMetadata as Prisma.InputJsonObject,
        });
        const confirmed = await this.prisma.encounterOperation.updateMany({
          where: {
            id: operation.id,
            tenantId: context.tenantId,
            attemptCount: claimedAttempt,
          },
          data: { mutationState: 'CONFIRMED' },
        });
        if (confirmed.count !== 1) {
          items.push({ operationId: operation.id, outcome: 'REQUIRES_OPERATOR_REVIEW' });
          continue;
        }
        if (!delivered) {
          const dependencyReady = await this.prisma.isReady().catch(() => false);
          const failure = dependencyReady ? 'AUDIT_DELIVERY_FAILED' : 'DEPENDENCY_UNAVAILABLE';
          await this.finishReconciliation(operation.id, claimedAttempt, failure);
          items.push({
            operationId: operation.id,
            outcome: dependencyReady
              ? 'MUTATION_EVIDENCE_FOUND_AUDIT_FAILED'
              : 'DEPENDENCY_UNAVAILABLE',
          });
          continue;
        }
        const finalized = await this.prisma.encounterOperation.updateMany({
          where: {
            id: operation.id,
            tenantId: context.tenantId,
            attemptCount: claimedAttempt,
          },
          data: {
            auditDeliveryStatus: 'RECONCILED',
            mutationState: 'CONFIRMED',
            reconciliationOutcome: 'AUDIT_DELIVERED_OR_ALREADY_DELIVERED',
            lastFailureClassification: null,
          },
        });
        items.push({
          operationId: operation.id,
          outcome:
            finalized.count === 1
              ? 'AUDIT_DELIVERED_OR_ALREADY_DELIVERED'
              : 'REQUIRES_OPERATOR_REVIEW',
        });
      } catch {
        await this.finishReconciliation(operation.id, claimedAttempt, 'DEPENDENCY_UNAVAILABLE');
        items.push({ operationId: operation.id, outcome: 'DEPENDENCY_UNAVAILABLE' });
      }
    }
    return { items };
  }

  private async finishReconciliation(
    id: string,
    attemptCount: number,
    failure: string,
  ): Promise<void> {
    try {
      await this.prisma?.encounterOperation.updateMany({
        where: { id, attemptCount },
        data: {
          auditDeliveryStatus:
            failure === 'IDENTITY_MISMATCH' || attemptCount >= 5 ? 'REVIEW_REQUIRED' : 'FAILED',
          lastFailureClassification: failure,
          reconciliationOutcome: failure,
        },
      });
    } catch {
      this.logger.warn('Encounter audit reconciliation state update failed');
    }
  }

  private async finishAmbiguousReconciliation(
    id: string,
    attemptCount: number,
    reason: string,
  ): Promise<void> {
    try {
      await this.prisma?.encounterOperation.updateMany({
        where: { id, attemptCount, mutationState: 'PREPARED' },
        data: {
          mutationState: 'AMBIGUOUS',
          auditDeliveryStatus: 'REVIEW_REQUIRED',
          lastFailureClassification: reason,
          reconciliationOutcome: 'AMBIGUOUS_REQUIRES_REVIEW',
        },
      });
    } catch {
      this.logger.warn('Encounter ambiguous operation state update failed');
    }
  }

  async effectiveTimeZones(
    context: TrustedTenantContext,
    input: EncounterEffectiveTimeZonesQuery,
  ): Promise<{
    items: Array<{
      facilityId: string;
      timeZone: string | null;
      status: 'ACTIVE_POLICY' | 'NO_ACTIVE_POLICY';
    }>;
  }> {
    await this.authorization.authorize(context, 'tenant.encounters.read');
    const parsed = encounterEffectiveTimeZonesQuerySchema.safeParse(input);
    if (!parsed.success) throw new EncounterInputValidationError();
    const membershipScope = await this.staffScopes.resolveMembershipScope(context);
    if (
      membershipScope !== null &&
      parsed.data.facilityIds.some(
        (facilityId) =>
          !membershipScope.facilities.some((facility) => facility.id === facilityId) &&
          !membershipScope.branches.some((branch) => branch.facilityId === facilityId),
      )
    ) {
      throw new EncounterScopeForbiddenError();
    }
    const timeZones = await this.schedulingPolicies.effectiveTimeZones(
      context,
      parsed.data.facilityIds,
    );
    return {
      items: parsed.data.facilityIds.map((facilityId) => {
        const timeZone = timeZones.get(facilityId) ?? null;
        return {
          facilityId,
          timeZone,
          status: timeZone ? ('ACTIVE_POLICY' as const) : ('NO_ACTIVE_POLICY' as const),
        };
      }),
    };
  }

  private async listRecords(
    context: TrustedTenantContext,
    query: ReturnType<typeof listEncountersQuerySchema.parse>,
  ): Promise<{
    items: EncounterRecord[];
    total: number;
    limit: number;
    offset: number;
    hasNext: boolean;
  }> {
    const accessScope = await this.accessScope(context);
    this.assertQueryScope(accessScope, query);
    let from = query.from;
    let to = query.to;
    if (query.fromDate || query.toDate) {
      const timeZone = await this.schedulingPolicies.effectiveTimeZone(context, query.facilityId!);
      if (!timeZone) throw new EncounterTimeZoneUnavailableError();
      try {
        const range = localDateRangeToUtc(query.fromDate, query.toDate, timeZone);
        from = range.from;
        to = range.to;
      } catch {
        throw new EncounterInputValidationError();
      }
    }
    const filter: EncounterListFilter = {
      search: query.search,
      appointmentId: query.appointmentId,
      patientId: query.patientId,
      doctorId: query.doctorId,
      facilityId: query.facilityId,
      branchId: query.branchId,
      status: query.status,
      from,
      to,
      limit: query.limit,
      offset: query.offset,
      accessScope,
    };
    const result = await this.encounters.list(context, filter);
    return result;
  }

  private async findInScope(
    context: TrustedTenantContext,
    encounterId: string,
  ): Promise<EncounterRecord> {
    const parsed = encounterIdSchema.safeParse(encounterId);
    if (!parsed.success) throw new EncounterInputValidationError();
    const record = await this.encounters.findById(context, parsed.data);
    if (!record) throw new EncounterNotFoundError();
    await this.assertLocationScope(context, record.facilityId, record.branchId, true);
    return record;
  }

  private async validateReferences(
    context: TrustedTenantContext,
    references: {
      patientId: string;
      doctorId: string;
      facilityId: string;
      branchId: string | null;
    },
  ): Promise<void> {
    const [patient, doctor, facility] = await Promise.all([
      this.reference(() => this.patients.findById(context, references.patientId)),
      this.reference(() => this.doctors.findById(context, references.doctorId)),
      this.reference(() => this.facilities.findById(context, references.facilityId)),
    ]);
    if (
      patient.status !== 'ACTIVE' ||
      !doctor.operationallyActive ||
      facility.status !== 'ACTIVE'
    ) {
      throw new EncounterReferenceInvalidError();
    }
    if (references.branchId) {
      const branch = await this.reference(() =>
        this.branches.findById(context, references.facilityId, references.branchId!),
      );
      if (branch.facilityId !== references.facilityId || branch.status !== 'ACTIVE') {
        throw new EncounterReferenceInvalidError();
      }
    }
    const [facilityAssignments, branchAssignments] = await Promise.all([
      this.staffScopes.listFacilities(context, doctor.staffId),
      this.staffScopes.listBranches(context, doctor.staffId),
    ]);
    const assignedToFacility = facilityAssignments.items.some(
      (assignment) =>
        assignment.facilityId === references.facilityId && assignment.facilityStatus === 'ACTIVE',
    );
    const assignedToBranch =
      references.branchId !== null &&
      branchAssignments.items.some(
        (assignment) =>
          assignment.branchId === references.branchId &&
          assignment.facility.id === references.facilityId &&
          assignment.branchStatus === 'ACTIVE' &&
          assignment.facility.status === 'ACTIVE',
      );
    if (!assignedToFacility && !assignedToBranch) throw new EncounterReferenceInvalidError();
  }

  private async buildServiceRecords(
    context: TrustedTenantContext,
    encounter: EncounterRecord,
    inputs: ReplaceEncounterServiceRecordsInput['serviceRecords'],
    existing: EncounterServiceRecord[],
    actorUserId: string,
    occurredAt: Date,
    allowAmendmentCorrections = false,
  ): Promise<EncounterServiceRecord[]> {
    const existingById = new Map(existing.map((item) => [item.id, item]));
    const submittedIds = new Set<string>();
    const next: EncounterServiceRecord[] = [];

    for (const input of inputs) {
      const previous = input.id ? existingById.get(input.id) : undefined;
      if (
        (input.id && !previous) ||
        (input.id && submittedIds.has(input.id)) ||
        (previous && previous.serviceId !== input.serviceId && !allowAmendmentCorrections)
      ) {
        throw new EncounterInputValidationError();
      }
      if (input.id) submittedIds.add(input.id);

      const status = input.status ?? previous?.status ?? 'PLANNED';
      const note = input.note === undefined ? (previous?.note ?? null) : input.note;
      const providerDoctorId =
        input.providerDoctorId ?? previous?.providerDoctorId ?? encounter.doctorId;
      if (previous && (previous.status === 'COMPLETED' || previous.status === 'CANCELLED')) {
        if (previous.status !== status) throw new EncounterStateConflictError();
        if (!allowAmendmentCorrections) {
          if (
            previous.note !== note ||
            previous.serviceId !== input.serviceId ||
            previous.providerDoctorId !== providerDoctorId
          ) {
            throw new EncounterStateConflictError();
          }
          next.push(structuredClone(previous));
          continue;
        }
        if (
          previous.serviceId === input.serviceId &&
          previous.providerDoctorId === providerDoctorId
        ) {
          next.push(
            previous.note === note
              ? structuredClone(previous)
              : { ...previous, note, updatedAt: occurredAt, updatedBy: actorUserId },
          );
          continue;
        }
      }

      const service = await this.reference(() => this.services.findById(context, input.serviceId));
      if (service.status !== 'ACTIVE') throw new EncounterReferenceInvalidError();
      const doctor = await this.reference(() => this.doctors.findById(context, providerDoctorId));
      if (!doctor.operationallyActive) throw new EncounterReferenceInvalidError();
      await this.assertDoctorAssignedToEncounter(context, doctor.staffId, encounter);

      if (!previous && status !== 'PLANNED') throw new EncounterStateConflictError();
      if (previous && !canTransitionServiceStatus(previous.status, status)) {
        throw new EncounterStateConflictError();
      }
      if (
        previous &&
        !allowAmendmentCorrections &&
        previous.status !== 'PLANNED' &&
        previous.providerDoctorId !== providerDoctorId
      ) {
        throw new EncounterStateConflictError();
      }
      const id = previous?.id ?? randomUUID();
      next.push({
        id,
        serviceId: service.id,
        serviceCode: service.code ?? null,
        serviceName: service.name,
        providerDoctorId: doctor.id,
        status,
        note,
        startedAt:
          status === 'IN_PROGRESS'
            ? (previous?.startedAt ?? occurredAt)
            : (previous?.startedAt ?? null),
        completedAt:
          status === 'COMPLETED'
            ? (previous?.completedAt ?? occurredAt)
            : (previous?.completedAt ?? null),
        cancelledAt:
          status === 'CANCELLED'
            ? (previous?.cancelledAt ?? occurredAt)
            : (previous?.cancelledAt ?? null),
        createdAt: previous?.createdAt ?? occurredAt,
        createdBy: previous?.createdBy ?? actorUserId,
        updatedAt: occurredAt,
        updatedBy: actorUserId,
      });
    }

    for (const previous of existing) {
      if (submittedIds.has(previous.id) || next.some((item) => item.id === previous.id)) continue;
      if (
        previous.status !== 'PLANNED' &&
        !(
          allowAmendmentCorrections &&
          (previous.status === 'COMPLETED' || previous.status === 'CANCELLED')
        )
      ) {
        throw new EncounterStateConflictError();
      }
    }
    return next;
  }

  private async assertDoctorAssignedToEncounter(
    context: TrustedTenantContext,
    staffId: string,
    encounter: Pick<EncounterRecord, 'facilityId' | 'branchId'>,
  ): Promise<void> {
    const [facilityAssignments, branchAssignments] = await Promise.all([
      this.staffScopes.listFacilities(context, staffId),
      this.staffScopes.listBranches(context, staffId),
    ]);
    const assignedToFacility = facilityAssignments.items.some(
      (assignment) =>
        assignment.facilityId === encounter.facilityId && assignment.facilityStatus === 'ACTIVE',
    );
    const assignedToBranch =
      encounter.branchId !== null &&
      branchAssignments.items.some(
        (assignment) =>
          assignment.branchId === encounter.branchId &&
          assignment.facility.id === encounter.facilityId &&
          assignment.branchStatus === 'ACTIVE' &&
          assignment.facility.status === 'ACTIVE',
      );
    if (!assignedToFacility && !assignedToBranch) throw new EncounterReferenceInvalidError();
  }

  private async reference<T>(lookup: () => Promise<T>): Promise<T> {
    try {
      return await lookup();
    } catch (error) {
      if (error instanceof NotFoundException) throw new EncounterReferenceInvalidError();
      throw error;
    }
  }

  private async accessScope(context: TrustedTenantContext): Promise<EncounterAccessScope> {
    const membershipScope = await this.staffScopes.resolveMembershipScope(context);
    if (membershipScope === null) {
      return { unrestricted: true, facilityIds: [], branchIds: [] };
    }
    return {
      unrestricted: false,
      facilityIds: membershipScope.facilities.map((facility) => facility.id),
      branchIds: membershipScope.branches.map((branch) => branch.id),
    };
  }

  private async assertLocationScope(
    context: TrustedTenantContext,
    facilityId: string,
    branchId: string | null,
    hideOutOfScope = false,
  ): Promise<void> {
    const scope = await this.accessScope(context);
    const allowed =
      scope.unrestricted ||
      scope.facilityIds.includes(facilityId) ||
      (branchId !== null && scope.branchIds.includes(branchId));
    if (!allowed) {
      if (hideOutOfScope) throw new EncounterNotFoundError();
      throw new EncounterScopeForbiddenError();
    }
  }

  private assertQueryScope(
    scope: EncounterAccessScope,
    query: ReturnType<typeof listEncountersQuerySchema.parse>,
  ): void {
    if (scope.unrestricted) return;
    if (
      query.facilityId &&
      !scope.facilityIds.includes(query.facilityId) &&
      !(query.branchId && scope.branchIds.includes(query.branchId))
    ) {
      throw new EncounterScopeForbiddenError();
    }
    if (query.branchId && !query.facilityId && !scope.branchIds.includes(query.branchId)) {
      throw new EncounterScopeForbiddenError();
    }
  }

  private async throwWriteConflict(
    context: TrustedTenantContext,
    encounterId: string,
    expectedVersion: number,
  ): Promise<never> {
    const latest = await this.encounters.findById(context, encounterId);
    if (!latest) throw new EncounterNotFoundError();
    if (latest.version !== expectedVersion) throw new EncounterVersionConflictError();
    throw new EncounterStateConflictError();
  }

  private async authorizeEncounterDetailReads(context: TrustedTenantContext): Promise<void> {
    await this.authorization.authorize(context, 'tenant.encounters.diagnoses.read');
    await this.authorization.authorize(context, 'tenant.encounters.services.read');
  }

  private assertExpectedVersion(record: EncounterRecord, expectedVersion: number): void {
    if (record.version !== expectedVersion) throw new EncounterVersionConflictError();
  }

  private assertHistoryCapacity(record: EncounterRecord): void {
    if (record.history.length >= MAX_ENCOUNTER_HISTORY_EVENTS) {
      throw new EncounterHistoryLimitError();
    }
  }

  private newRecord(
    actor: AuthenticatedPlatformUser,
    references: {
      appointmentId: string | null;
      patientId: string;
      doctorId: string;
      facilityId: string;
      branchId: string | null;
    },
    now: Date,
    encounterId?: string,
  ): EncounterRecord {
    const event: EncounterHistoryEvent = {
      id: randomUUID(),
      action: 'CREATED',
      actorUserId: actor.userId,
      occurredAt: now,
      fromVersion: 0,
      toVersion: 1,
      changedFields: Object.keys(references),
    };
    return {
      id: encounterId ?? randomUUID(),
      ...references,
      encounterAt: now,
      status: EncounterStatus.DRAFT,
      clinical: {},
      diagnoses: [],
      serviceRecords: [],
      amendments: [],
      version: 1,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.userId,
      updatedBy: actor.userId,
      completedAt: null,
      completedBy: null,
      cancelledAt: null,
      cancelledBy: null,
      cancellationReason: null,
      history: [event],
    };
  }

  private createIdempotency(
    context: TrustedTenantContext,
    actor: AuthenticatedPlatformUser,
    route: 'direct' | 'from-appointment',
    key?: string,
    payload?: unknown,
  ): EncounterCreateIdempotencyDescriptor | null {
    if (key === undefined) return null;
    if (!this.prisma) {
      throw new ServiceUnavailableException('Encounter operation tracking is unavailable');
    }
    if (key.length < 1 || key.length > 128 || !/^[\x21-\x7e]+$/u.test(key)) {
      throw new EncounterInputValidationError();
    }
    const scope = `${context.tenantId.toLowerCase()}\u0000${actor.userId.toLowerCase()}\u0000${route}\u0000${key}`;
    return {
      resourceId: this.deterministicUuid(`encounter-resource\u0000${scope}`),
      operationId: this.deterministicUuid(`encounter-operation\u0000${scope}`),
      keyHash: createHash('sha256').update(key).digest('hex'),
      fingerprint: createHash('sha256').update(stableSerialize(payload)).digest('hex'),
      route,
    };
  }

  private async assertCreationReplay(
    context: TrustedTenantContext,
    actor: AuthenticatedPlatformUser,
    record: EncounterRecord,
    idempotency: EncounterCreateIdempotencyDescriptor,
  ): Promise<void> {
    const event = record.history.find((item) => item.id === idempotency.operationId);
    if (
      !event ||
      event.actorUserId !== actor.userId ||
      event.action !== 'CREATED' ||
      event.fromVersion !== 0 ||
      event.toVersion !== 1
    ) {
      throw new EncounterIdempotencyConflictError();
    }
    let operation: Awaited<ReturnType<PrismaService['encounterOperation']['findUnique']>>;
    try {
      operation = await this.prisma!.encounterOperation.findUnique({
        where: { id: idempotency.operationId },
      });
    } catch {
      throw new ServiceUnavailableException('Encounter operation tracking is unavailable');
    }
    if (!operation) {
      throw new ServiceUnavailableException('Encounter operation tracking is unavailable');
    }
    if (
      operation.tenantId !== context.tenantId ||
      operation.actorUserId !== actor.userId ||
      operation.resourceId !== record.id ||
      operation.historyEventId !== event.id ||
      operation.expectedVersion !== 0 ||
      operation.operationType !== event.action ||
      operation.mutationState === 'NOT_APPLIED' ||
      this.idempotencyMetadata(operation.auditMetadata)?.idempotencyKeyHash !==
        idempotency.keyHash ||
      this.idempotencyMetadata(operation.auditMetadata)?.requestFingerprint !==
        idempotency.fingerprint
    ) {
      throw new EncounterIdempotencyConflictError();
    }
  }

  private historyEvent(
    actor: AuthenticatedPlatformUser,
    action: EncounterHistoryAction,
    occurredAt: Date,
    version: number,
    changedFields: string[],
  ): EncounterHistoryEvent {
    return {
      id: randomUUID(),
      action,
      actorUserId: actor.userId,
      occurredAt,
      fromVersion: version,
      toVersion: version + 1,
      changedFields: [...changedFields],
    };
  }

  private async prepareOperation(
    context: TrustedTenantContext,
    actor: AuthenticatedPlatformUser,
    record: EncounterRecord,
    eventType: PlatformAuditEventType,
    action: string,
    changedFields: string[],
    idempotency?: EncounterIdempotencyDescriptor,
  ): Promise<void> {
    const event = record.history.at(-1);
    if (!event || !this.prisma) return;
    if (idempotency) event.id = idempotency.operationId;
    const auditMetadata = {
      resourceType: 'encounter',
      encounterId: record.id,
      facilityId: record.facilityId,
      action,
      changedFields: changedFields.join(',').slice(0, 512),
      ...(idempotency
        ? {
            idempotencyKeyHash: idempotency.keyHash,
            requestFingerprint: idempotency.fingerprint,
            idempotencyRoute: idempotency.route,
          }
        : {}),
    };
    try {
      await this.prisma.encounterOperation.create({
        data: {
          id: event.id,
          historyEventId: event.id,
          tenantId: context.tenantId,
          resourceType: 'encounter',
          resourceId: record.id,
          operationType: event.action,
          actorUserId: actor.userId,
          auditEventType: eventType,
          auditMetadata: auditMetadata as Prisma.InputJsonObject,
          mutationState: 'PREPARED',
          expectedVersion: event.fromVersion,
        },
      });
    } catch {
      if (idempotency) {
        try {
          const existing = await this.prisma.encounterOperation.findUnique({
            where: { id: idempotency.operationId },
          });
          if (existing) {
            const metadata = this.idempotencyMetadata(existing.auditMetadata);
            if (metadata?.requestFingerprint !== idempotency.fingerprint) {
              throw new EncounterIdempotencyConflictError();
            }
            if (
              existing.mutationState === 'NOT_APPLIED' &&
              existing.expectedVersion === event.fromVersion
            ) {
              const rearmed = await this.prisma.encounterOperation.updateMany({
                where: {
                  id: existing.id,
                  tenantId: context.tenantId,
                  attemptCount: existing.attemptCount,
                  mutationState: 'NOT_APPLIED',
                },
                data: {
                  mutationState: 'PREPARED',
                  auditDeliveryStatus: 'PENDING',
                  auditMetadata: auditMetadata as Prisma.InputJsonObject,
                  expectedVersion: event.fromVersion,
                  lastFailureClassification: null,
                  reconciliationOutcome: null,
                  lastAttemptAt: null,
                },
              });
              if (rearmed.count === 1) return;
            }
            throw new EncounterIdempotencyInProgressError();
          }
        } catch (error) {
          if (
            error instanceof EncounterIdempotencyConflictError ||
            error instanceof EncounterIdempotencyInProgressError
          ) {
            throw error;
          }
        }
      }
      // The Mongo write must not start unless the durable marker is known to exist.
      this.logger.warn('Encounter pre-write operation marker persistence failed');
      throw new ServiceUnavailableException('Encounter operation tracking is unavailable');
    }
  }

  private mutationIdempotency(
    context: TrustedTenantContext,
    actor: AuthenticatedPlatformUser,
    route: string,
    resourceId: string,
    key: string | undefined,
    payload: unknown,
  ): EncounterIdempotencyDescriptor | undefined {
    if (key === undefined) return undefined;
    if (!this.prisma) {
      throw new ServiceUnavailableException('Encounter operation tracking is unavailable');
    }
    if (key.length < 1 || key.length > 128 || !/^[\x21-\x7e]+$/u.test(key)) {
      throw new EncounterInputValidationError();
    }
    const scope = `${context.tenantId.toLowerCase()}\u0000${actor.userId.toLowerCase()}\u0000${route}\u0000${resourceId.toLowerCase()}`;
    return {
      operationId: this.deterministicUuid(`encounter-mutation\u0000${scope}\u0000${key}`),
      keyHash: createHash('sha256').update(key).digest('hex'),
      fingerprint: createHash('sha256').update(stableSerialize(payload)).digest('hex'),
      route,
    };
  }

  private deterministicUuid(value: string): string {
    const hex = createHash('sha256').update(value).digest('hex').slice(0, 32).split('');
    hex[12] = '5';
    hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
    const id = hex.join('');
    return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
  }

  private idempotencyMetadata(value: Prisma.JsonValue): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private async replayMutation(
    context: TrustedTenantContext,
    actor: AuthenticatedPlatformUser,
    requestContext: EncounterAuditRequestContext,
    record: EncounterRecord,
    idempotency: EncounterIdempotencyDescriptor | undefined,
    eventType: PlatformAuditEventType,
  ): Promise<EncounterResponse | null> {
    if (!idempotency) return null;
    let operation: Awaited<ReturnType<PrismaService['encounterOperation']['findUnique']>>;
    try {
      operation = await this.prisma!.encounterOperation.findUnique({
        where: { id: idempotency.operationId },
      });
    } catch {
      throw new ServiceUnavailableException('Encounter operation tracking is unavailable');
    }
    if (!operation) return null;
    const metadata = this.idempotencyMetadata(operation.auditMetadata);
    if (
      operation.tenantId !== context.tenantId ||
      operation.actorUserId !== actor.userId ||
      operation.resourceId !== record.id ||
      operation.historyEventId !== idempotency.operationId ||
      operation.auditEventType !== eventType ||
      metadata?.idempotencyKeyHash !== idempotency.keyHash ||
      metadata?.requestFingerprint !== idempotency.fingerprint ||
      metadata?.idempotencyRoute !== idempotency.route
    ) {
      throw new EncounterIdempotencyConflictError();
    }
    const event = record.history.find((item) => item.id === idempotency.operationId);
    if (operation.mutationState === 'NOT_APPLIED' && !event) return null;
    if (
      !event ||
      event.actorUserId !== actor.userId ||
      event.action !== operation.operationType ||
      event.fromVersion !== operation.expectedVersion ||
      operation.mutationState === 'NOT_APPLIED'
    ) {
      throw new EncounterIdempotencyReviewError();
    }
    await this.recordAudit(
      context,
      actor,
      record,
      eventType,
      String(metadata.action ?? idempotency.route),
      event.changedFields,
      requestContext,
      idempotency,
    );
    return this.present(record);
  }

  private async markOperationNotApplied(id: string, tenantId: string): Promise<void> {
    try {
      await this.prisma?.encounterOperation.updateMany({
        where: { id, tenantId, mutationState: 'PREPARED' },
        data: {
          mutationState: 'NOT_APPLIED',
          auditDeliveryStatus: 'REVIEW_REQUIRED',
          reconciliationOutcome: 'NOT_APPLIED_WITH_EVIDENCE',
        },
      });
    } catch {
      this.logger.warn('Encounter definite non-application state update failed');
    }
  }

  private async recordAudit(
    context: TrustedTenantContext,
    actor: AuthenticatedPlatformUser,
    record: EncounterRecord,
    eventType: PlatformAuditEventType,
    action: string,
    changedFields: string[],
    requestContext: EncounterAuditRequestContext,
    idempotency?: EncounterIdempotencyDescriptor,
  ): Promise<void> {
    const event = record.history.at(-1);
    const auditInput: CreatePlatformAuditInput = {
      eventType,
      eventId: event?.id,
      actorUserId: actor.userId,
      subjectTenantId: context.tenantId,
      requestId: requestContext.requestId,
      ipAddress: requestContext.ipAddress,
      userAgent: requestContext.userAgent,
      metadata: {
        resourceType: 'encounter',
        encounterId: record.id,
        facilityId: record.facilityId,
        action,
        changedFields: changedFields.join(',').slice(0, 512),
        ...(idempotency
          ? {
              idempotencyKeyHash: idempotency.keyHash,
              requestFingerprint: idempotency.fingerprint,
              idempotencyRoute: idempotency.route,
            }
          : {}),
      },
    };
    if (event && this.prisma) {
      try {
        await this.prisma.encounterOperation.updateMany({
          where: {
            id: event.id,
            tenantId: context.tenantId,
            mutationState: 'PREPARED',
          },
          data: {
            mutationState: 'CONFIRMED',
            auditEventType: eventType,
            auditMetadata: auditInput.metadata as Prisma.InputJsonObject,
          },
        });
      } catch {
        // The durable pre-write marker remains available for history-based reconciliation.
        this.logger.warn('Encounter operation confirmation update failed');
      }
    }
    const delivered = await this.audit.recordAudit(auditInput);
    if (event && this.prisma) {
      try {
        await this.prisma.encounterOperation.updateMany({
          where: { id: event.id, tenantId: context.tenantId, auditDeliveryStatus: 'PENDING' },
          data: {
            auditDeliveryStatus: delivered ? 'DELIVERED' : 'FAILED',
            attemptCount: 1,
            lastAttemptAt: new Date(),
            lastFailureClassification: delivered ? null : 'AUDIT_DELIVERY_FAILED',
            reconciliationOutcome: delivered ? 'AUDIT_DELIVERED' : null,
          },
        });
      } catch {
        this.logger.warn('Encounter operation audit state update failed');
      }
    }
  }

  private assertActor(context: TrustedTenantContext, actor: AuthenticatedPlatformUser): void {
    if (
      !context ||
      !actor ||
      typeof actor.userId !== 'string' ||
      actor.userId.toLowerCase() !== context.platformUserId.toLowerCase()
    ) {
      throw new EncounterInputValidationError();
    }
  }

  private present(record: EncounterRecord): EncounterResponse {
    const { history: ignoredHistory, ...response } = record;
    void ignoredHistory;
    const amendments = record.amendments ?? [];
    const currentAmendment = amendments.at(-1);
    const snapshot = effectiveClinicalSnapshot(record);
    return {
      ...response,
      clinical: snapshot.clinical,
      diagnoses: snapshot.diagnoses,
      serviceRecords: snapshot.serviceRecords,
      amendments: amendments.map(
        ({ clinical: _clinical, diagnoses: _diagnoses, serviceRecords: _services, ...item }) =>
          item,
      ),
      currentRevision:
        currentAmendment?.status === 'OPEN'
          ? 'AMENDMENT_DRAFT'
          : currentAmendment
            ? 'AMENDED'
            : 'ORIGINAL',
      activeAmendmentId: currentAmendment?.status === 'OPEN' ? currentAmendment.id : null,
    };
  }

  private presentSummary(record: EncounterRecord): EncounterSummary {
    const {
      clinical: _clinical,
      diagnoses: _diagnoses,
      serviceRecords: _serviceRecords,
      amendments: _amendments,
      activeAmendmentId: _activeAmendmentId,
      ...response
    } = this.present(record);
    void [_clinical, _diagnoses, _serviceRecords, _amendments, _activeAmendmentId];
    return response;
  }
}

function buildDiagnosisRecords(
  inputs: ReplaceEncounterDiagnosesInput['diagnoses'],
  existing: EncounterDiagnosis[],
  actorUserId: string,
  occurredAt: Date,
): EncounterDiagnosis[] {
  const existingById = new Map(existing.map((diagnosis) => [diagnosis.id, diagnosis]));
  const submittedIds = new Set<string>();
  return inputs.map((input) => {
    const previous = input.id ? existingById.get(input.id) : undefined;
    if ((input.id && !previous) || (input.id && submittedIds.has(input.id))) {
      throw new EncounterInputValidationError();
    }
    if (input.id) submittedIds.add(input.id);
    return {
      id: previous?.id ?? randomUUID(),
      description: input.description,
      priority: input.priority,
      clinicalStatus: input.clinicalStatus,
      onsetAt: input.onsetAt === undefined ? (previous?.onsetAt ?? null) : input.onsetAt,
      recordedAt: previous?.recordedAt ?? occurredAt,
      recordedBy: previous?.recordedBy ?? actorUserId,
      updatedAt: occurredAt,
      updatedBy: actorUserId,
    };
  });
}

function effectiveClinicalSnapshot(record: EncounterRecord): {
  clinical: EncounterClinicalRecord;
  diagnoses: EncounterDiagnosis[];
  serviceRecords: EncounterServiceRecord[];
} {
  const latestAmendment = (record.amendments ?? []).at(-1);
  return latestAmendment
    ? {
        clinical: latestAmendment.clinical,
        diagnoses: latestAmendment.diagnoses ?? [],
        serviceRecords: latestAmendment.serviceRecords ?? [],
      }
    : {
        clinical: record.clinical,
        diagnoses: record.diagnoses ?? [],
        serviceRecords: record.serviceRecords ?? [],
      };
}

function canTransitionServiceStatus(
  previous: EncounterServiceStatus,
  next: EncounterServiceStatus,
): boolean {
  if (previous === next) return true;
  if (previous === 'PLANNED') return next === 'IN_PROGRESS' || next === 'CANCELLED';
  if (previous === 'IN_PROGRESS') return next === 'COMPLETED' || next === 'CANCELLED';
  return false;
}

function changedClinicalFields(patch: EncounterClinicalPatch): string[] {
  return Object.entries(patch).flatMap(([field, value]) => {
    if (field === 'vitalSigns' && value && typeof value === 'object') {
      return Object.keys(value).map((vital) => `vitalSigns.${vital}`);
    }
    return [field];
  });
}

function applyClinicalPatch(
  current: EncounterClinicalRecord,
  patch: EncounterClinicalPatch,
): EncounterClinicalRecord {
  const next = structuredClone(current);
  for (const [field, value] of Object.entries(patch)) {
    if (field === 'vitalSigns') {
      if (value === null) {
        delete next.vitalSigns;
      } else if (value && typeof value === 'object') {
        const vitals = { ...(next.vitalSigns ?? {}) } as Record<string, unknown>;
        for (const [name, reading] of Object.entries(value)) {
          if (reading === null) delete vitals[name];
          else vitals[name] = reading;
        }
        if (Object.keys(vitals).length) {
          next.vitalSigns = vitals as EncounterClinicalRecord['vitalSigns'];
        } else {
          delete next.vitalSigns;
        }
      }
    } else if (value === null) {
      delete next[field as keyof EncounterClinicalRecord];
    } else {
      (next as Record<string, unknown>)[field] = value;
    }
  }
  return next;
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(object[key])}`)
    .join(',')}}`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
