export const PatientStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
} as const;

export type PatientStatus = (typeof PatientStatus)[keyof typeof PatientStatus];

export interface PatientRecord {
  id: string;
  patientNumber: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  preferredName: string | null;
  dateOfBirth: Date | null;
  gender: string | null;
  phone: string | null;
  email: string | null;
  nationalId: string | null;
  address: string | null;
  status: PatientStatus;
  createdAt: Date;
  updatedAt: Date;
}

export type PatientMutationResult =
  | { kind: 'changed'; record: PatientRecord }
  | { kind: 'not-found' }
  | { kind: 'patient-number-conflict' }
  | { kind: 'not-changed' };
