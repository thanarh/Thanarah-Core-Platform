import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { EncounterStatus } from './encounter.model';

export class EncounterErrorResponseDto {
  @ApiProperty({ type: String })
  code!: string;

  @ApiProperty({ type: String })
  message!: string;
}

export class CreateEncounterFromAppointmentRequestDto {
  @ApiProperty({ type: String, format: 'uuid' })
  appointmentId!: string;
}

export class CreateDirectEncounterRequestDto {
  @ApiProperty({ type: String, format: 'uuid' })
  patientId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  doctorId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  facilityId!: string;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  branchId?: string;
}

export class EncounterVitalMeasurementRequestDto {
  @ApiProperty({ type: Number })
  value!: number;

  @ApiProperty({ type: String })
  unit!: string;
}

export class EncounterVitalSignsRequestDto {
  @ApiPropertyOptional({ type: EncounterVitalMeasurementRequestDto })
  systolicBloodPressure?: EncounterVitalMeasurementRequestDto | null;

  @ApiPropertyOptional({ type: EncounterVitalMeasurementRequestDto })
  diastolicBloodPressure?: EncounterVitalMeasurementRequestDto | null;

  @ApiPropertyOptional({ type: EncounterVitalMeasurementRequestDto })
  heartRate?: EncounterVitalMeasurementRequestDto | null;

  @ApiPropertyOptional({ type: EncounterVitalMeasurementRequestDto })
  respiratoryRate?: EncounterVitalMeasurementRequestDto | null;

  @ApiPropertyOptional({ type: EncounterVitalMeasurementRequestDto })
  temperature?: EncounterVitalMeasurementRequestDto | null;

  @ApiPropertyOptional({ type: EncounterVitalMeasurementRequestDto })
  oxygenSaturation?: EncounterVitalMeasurementRequestDto | null;

  @ApiPropertyOptional({ type: EncounterVitalMeasurementRequestDto })
  height?: EncounterVitalMeasurementRequestDto | null;

  @ApiPropertyOptional({ type: EncounterVitalMeasurementRequestDto })
  weight?: EncounterVitalMeasurementRequestDto | null;
}

export class EncounterClinicalPatchRequestDto {
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 8_000 })
  reason?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 8_000 })
  chiefComplaint?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 8_000 })
  historyOfPresentIllness?: string | null;

  @ApiPropertyOptional({
    type: 'object',
    nullable: true,
    additionalProperties: true,
    description: 'Fact object with status UNKNOWN, NEGATIVE, or DOCUMENTED and text.',
  })
  medicalHistory?: Record<string, unknown> | null;

  @ApiPropertyOptional({ type: 'object', nullable: true, additionalProperties: true })
  allergies?: Record<string, unknown> | null;

  @ApiPropertyOptional({ type: 'object', nullable: true, additionalProperties: true })
  medicationHistory?: Record<string, unknown> | null;

  @ApiPropertyOptional({ type: 'object', nullable: true, additionalProperties: true })
  reviewOfSystems?: Record<string, unknown> | null;

  @ApiPropertyOptional({ type: EncounterVitalSignsRequestDto, nullable: true })
  vitalSigns?: EncounterVitalSignsRequestDto | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 8_000 })
  examinationFindings?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 8_000 })
  assessment?: string | null;

  @ApiPropertyOptional({
    type: [String],
    nullable: true,
    maxItems: 20,
    description: 'Free-text diagnoses; no code system is implied.',
  })
  diagnoses?: string[] | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 8_000 })
  plan?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 8_000 })
  followUp?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 8_000 })
  internalNotes?: string | null;
}

export class UpdateEncounterRequestDto {
  @ApiProperty({ type: Number, minimum: 1 })
  expectedVersion!: number;

  @ApiProperty({ type: EncounterClinicalPatchRequestDto })
  clinical!: EncounterClinicalPatchRequestDto;
}

export class EncounterLifecycleRequestDto {
  @ApiProperty({ type: Number, minimum: 1 })
  expectedVersion!: number;
}

export class CancelEncounterRequestDto extends EncounterLifecycleRequestDto {
  @ApiPropertyOptional({ type: String, maxLength: 500 })
  reason?: string;
}

export class EncounterResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  appointmentId!: string | null;

  @ApiProperty({ type: String, format: 'uuid' })
  patientId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  doctorId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  facilityId!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  branchId!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  encounterAt!: Date;

  @ApiProperty({ type: String, enum: Object.values(EncounterStatus) })
  status!: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  clinical!: Record<string, unknown>;

  @ApiProperty({ type: Number })
  version!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty({ type: String, format: 'uuid' })
  createdBy!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  updatedBy!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  completedAt!: Date | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  completedBy!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  cancelledAt!: Date | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  cancelledBy!: string | null;

  @ApiProperty({ type: String, nullable: true, maxLength: 500 })
  cancellationReason!: string | null;
}

export class EncounterSummaryResponseDto extends OmitType(EncounterResponseDto, [
  'clinical',
] as const) {}

export class EncounterListResponseDto {
  @ApiProperty({ type: [EncounterSummaryResponseDto] })
  items!: EncounterSummaryResponseDto[];

  @ApiProperty({ type: Number })
  total!: number;

  @ApiProperty({ type: Number })
  limit!: number;

  @ApiProperty({ type: Number })
  offset!: number;

  @ApiProperty({ type: Boolean })
  hasNext!: boolean;
}

export class PatientEncounterHistoryResponseDto {
  @ApiProperty({ type: [EncounterResponseDto] })
  items!: EncounterResponseDto[];

  @ApiProperty({ type: Number })
  total!: number;

  @ApiProperty({ type: Number })
  limit!: number;

  @ApiProperty({ type: Number })
  offset!: number;

  @ApiProperty({ type: Boolean })
  hasNext!: boolean;
}

export class EncounterHistoryEventResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, enum: ['CREATED', 'CLINICAL_UPDATED', 'COMPLETED', 'CANCELLED'] })
  action!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  actorUserId!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  occurredAt!: Date;

  @ApiProperty({ type: Number })
  fromVersion!: number;

  @ApiProperty({ type: Number })
  toVersion!: number;

  @ApiProperty({ type: [String] })
  changedFields!: string[];
}
