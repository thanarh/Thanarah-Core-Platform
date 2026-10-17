export const EncounterStatus = {
  DRAFT: 'DRAFT',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;

export type EncounterStatus = (typeof EncounterStatus)[keyof typeof EncounterStatus];

export type EncounterFact =
  { status: 'UNKNOWN' } | { status: 'NEGATIVE' } | { status: 'DOCUMENTED'; text: string };

export interface VitalMeasurement<Unit extends string> {
  value: number;
  unit: Unit;
}

export interface EncounterVitalSigns {
  systolicBloodPressure?: VitalMeasurement<'mmHg'>;
  diastolicBloodPressure?: VitalMeasurement<'mmHg'>;
  heartRate?: VitalMeasurement<'bpm'>;
  respiratoryRate?: VitalMeasurement<'breaths/min'>;
  temperature?: VitalMeasurement<'°C' | '°F'>;
  oxygenSaturation?: VitalMeasurement<'%'>;
  height?: VitalMeasurement<'cm'>;
  weight?: VitalMeasurement<'kg'>;
}

export interface EncounterClinicalRecord {
  reason?: string;
  chiefComplaint?: string;
  historyOfPresentIllness?: string;
  medicalHistory?: EncounterFact;
  allergies?: EncounterFact;
  medicationHistory?: EncounterFact;
  reviewOfSystems?: EncounterFact;
  vitalSigns?: EncounterVitalSigns;
  examinationFindings?: string;
  assessment?: string;
  diagnoses?: string[];
  plan?: string;
  followUp?: string;
  internalNotes?: string;
}

export type EncounterDiagnosisPriority = 'PRIMARY' | 'SECONDARY';
export type EncounterDiagnosisStatus = 'ACTIVE' | 'RESOLVED' | 'INACTIVE';

export interface EncounterDiagnosis {
  id: string;
  description: string;
  priority: EncounterDiagnosisPriority;
  clinicalStatus: EncounterDiagnosisStatus;
  onsetAt: Date | null;
  recordedAt: Date;
  recordedBy: string;
  updatedAt: Date;
  updatedBy: string;
}

export type EncounterServiceStatus = 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export interface EncounterServiceRecord {
  id: string;
  serviceId: string;
  serviceCode: string | null;
  serviceName: string;
  providerDoctorId: string;
  status: EncounterServiceStatus;
  note: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  updatedBy: string;
}

export type EncounterAmendmentStatus = 'OPEN' | 'FINALIZED';
export type EncounterRevisionStatus = 'ORIGINAL' | 'AMENDMENT_DRAFT' | 'AMENDED';

export interface EncounterAmendment {
  id: string;
  reason: string;
  status: EncounterAmendmentStatus;
  clinical: EncounterClinicalRecord;
  diagnoses: EncounterDiagnosis[];
  serviceRecords: EncounterServiceRecord[];
  createdAt: Date;
  createdBy: string;
  finalizedAt: Date | null;
  finalizedBy: string | null;
}

export type EncounterAmendmentSummary = Omit<
  EncounterAmendment,
  'clinical' | 'diagnoses' | 'serviceRecords'
>;

export type EncounterHistoryAction =
  | 'CREATED'
  | 'CLINICAL_UPDATED'
  | 'DIAGNOSES_UPDATED'
  | 'SERVICE_RECORDS_UPDATED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'AMENDMENT_OPENED'
  | 'AMENDMENT_UPDATED'
  | 'AMENDMENT_FINALIZED';

/** Metadata only: this trail must never contain clinical values or note text. */
export interface EncounterHistoryEvent {
  id: string;
  action: EncounterHistoryAction;
  actorUserId: string;
  occurredAt: Date;
  fromVersion: number;
  toVersion: number;
  changedFields: string[];
}

export interface EncounterRecord {
  id: string;
  appointmentId: string | null;
  patientId: string;
  doctorId: string;
  facilityId: string;
  branchId: string | null;
  encounterAt: Date;
  status: EncounterStatus;
  clinical: EncounterClinicalRecord;
  diagnoses: EncounterDiagnosis[];
  serviceRecords: EncounterServiceRecord[];
  amendments: EncounterAmendment[];
  version: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  updatedBy: string;
  completedAt: Date | null;
  completedBy: string | null;
  cancelledAt: Date | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
  history: EncounterHistoryEvent[];
}

export type EncounterResponse = Omit<EncounterRecord, 'history' | 'amendments'> & {
  amendments: EncounterAmendmentSummary[];
  currentRevision: EncounterRevisionStatus;
  activeAmendmentId: string | null;
};
export type EncounterSummary = Omit<
  EncounterResponse,
  'clinical' | 'diagnoses' | 'serviceRecords' | 'amendments' | 'activeAmendmentId'
>;

export interface EncounterListResponse extends Omit<EncounterListResult, 'items'> {
  items: EncounterSummary[];
}

export interface PatientEncounterHistoryResponse extends Omit<EncounterListResult, 'items'> {
  items: EncounterResponse[];
}

export interface EncounterAccessScope {
  unrestricted: boolean;
  facilityIds: string[];
  branchIds: string[];
}

export interface EncounterListFilter {
  search?: string;
  appointmentId?: string;
  patientId?: string;
  doctorId?: string;
  facilityId?: string;
  branchId?: string;
  status?: EncounterStatus;
  from?: Date;
  to?: Date;
  limit: number;
  offset: number;
  accessScope: EncounterAccessScope;
}

export interface EncounterListResult {
  items: EncounterRecord[];
  total: number;
  limit: number;
  offset: number;
  hasNext: boolean;
}
