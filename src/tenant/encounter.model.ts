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

export type EncounterHistoryAction = 'CREATED' | 'CLINICAL_UPDATED' | 'COMPLETED' | 'CANCELLED';

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

export type EncounterResponse = Omit<EncounterRecord, 'history'>;
export type EncounterSummary = Omit<EncounterResponse, 'clinical'>;

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
