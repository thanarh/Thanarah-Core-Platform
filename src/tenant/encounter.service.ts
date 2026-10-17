import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
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
  EncounterInputValidationError,
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

const MAX_ENCOUNTER_HISTORY_EVENTS = 5_000;

export interface EncounterAuditRequestContext {
  requestId?: string;
  sessionId?: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class EncounterService {
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
    const record = this.newRecord(actor, { appointmentId: null, ...references }, new Date());
    const created = await this.encounters.create(context, record);
    await this.recordAudit(
      context,
      actor,
      created,
      PlatformAuditEventType.ENCOUNTER_CREATED,
      'created_direct',
      ['patientId', 'doctorId', 'facilityId', 'branchId'],
      requestContext,
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
    const updated = await this.encounters.update(
      context,
      current.id,
      current.version,
      EncounterStatus.DRAFT,
      { clinical: nextClinical, updatedAt: occurredAt, updatedBy: actor.userId },
      event,
    );
    if (!updated) await this.throwWriteConflict(context, current.id, current.version);
    await this.recordAudit(
      context,
      actor,
      updated!,
      PlatformAuditEventType.ENCOUNTER_CLINICAL_UPDATED,
      'clinical_updated',
      changedFields,
      requestContext,
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
    const updated = await this.encounters.update(
      context,
      current.id,
      current.version,
      EncounterStatus.DRAFT,
      { diagnoses, updatedAt: occurredAt, updatedBy: actor.userId },
      event,
    );
    if (!updated) await this.throwWriteConflict(context, current.id, current.version);
    await this.recordAudit(
      context,
      actor,
      updated!,
      PlatformAuditEventType.ENCOUNTER_CLINICAL_UPDATED,
      'diagnoses_updated',
      ['diagnoses'],
      requestContext,
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
    const updated = await this.encounters.update(
      context,
      current.id,
      current.version,
      EncounterStatus.DRAFT,
      { serviceRecords, updatedAt: occurredAt, updatedBy: actor.userId },
      event,
    );
    if (!updated) await this.throwWriteConflict(context, current.id, current.version);
    await this.recordAudit(
      context,
      actor,
      updated!,
      PlatformAuditEventType.ENCOUNTER_CLINICAL_UPDATED,
      'service_records_updated',
      ['serviceRecords'],
      requestContext,
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
    if (!updated) await this.throwWriteConflict(context, current.id, current.version);
    await this.recordAudit(
      context,
      actor,
      updated!,
      PlatformAuditEventType.ENCOUNTER_CLINICAL_UPDATED,
      'amendment_opened',
      ['amendment'],
      requestContext,
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
    const updated = await this.encounters.update(
      context,
      current.id,
      current.version,
      EncounterStatus.COMPLETED,
      { amendments, updatedAt: occurredAt, updatedBy: actor.userId },
      event,
    );
    if (!updated) await this.throwWriteConflict(context, current.id, current.version);
    await this.recordAudit(
      context,
      actor,
      updated!,
      PlatformAuditEventType.ENCOUNTER_CLINICAL_UPDATED,
      'amendment_updated',
      ['amendment', ...changedFields],
      requestContext,
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
    const updated = await this.encounters.update(
      context,
      current.id,
      current.version,
      EncounterStatus.COMPLETED,
      { amendments, updatedAt: occurredAt, updatedBy: actor.userId },
      event,
    );
    if (!updated) await this.throwWriteConflict(context, current.id, current.version);
    await this.recordAudit(
      context,
      actor,
      updated!,
      PlatformAuditEventType.ENCOUNTER_CLINICAL_UPDATED,
      'amendment_finalized',
      ['amendment.status'],
      requestContext,
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
    if (current.status !== EncounterStatus.DRAFT) throw new EncounterStateConflictError();
    if (current.version !== parsed.data.expectedVersion) throw new EncounterVersionConflictError();
    if (current.history.length >= MAX_ENCOUNTER_HISTORY_EVENTS) {
      throw new EncounterHistoryLimitError();
    }

    const occurredAt = new Date();
    const event = this.historyEvent(actor, 'COMPLETED', occurredAt, current.version, ['status']);
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
    if (!updated) await this.throwWriteConflict(context, current.id, current.version);
    await this.recordAudit(
      context,
      actor,
      updated!,
      PlatformAuditEventType.ENCOUNTER_COMPLETED,
      'completed',
      ['status'],
      requestContext,
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
    if (current.status !== EncounterStatus.DRAFT) throw new EncounterStateConflictError();
    if (current.version !== parsed.data.expectedVersion) throw new EncounterVersionConflictError();
    if (current.history.length >= MAX_ENCOUNTER_HISTORY_EVENTS) {
      throw new EncounterHistoryLimitError();
    }

    const occurredAt = new Date();
    const changedFields = parsed.data.reason ? ['status', 'cancellationReason'] : ['status'];
    const event = this.historyEvent(actor, 'CANCELLED', occurredAt, current.version, changedFields);
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
    if (!updated) await this.throwWriteConflict(context, current.id, current.version);
    await this.recordAudit(
      context,
      actor,
      updated!,
      PlatformAuditEventType.ENCOUNTER_CANCELLED,
      'cancelled',
      changedFields,
      requestContext,
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
      id: randomUUID(),
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

  private async recordAudit(
    context: TrustedTenantContext,
    actor: AuthenticatedPlatformUser,
    record: EncounterRecord,
    eventType: PlatformAuditEventType,
    action: string,
    changedFields: string[],
    requestContext: EncounterAuditRequestContext,
  ): Promise<void> {
    const auditInput: CreatePlatformAuditInput = {
      eventType,
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
      },
    };
    await this.audit.recordAudit(auditInput);
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
