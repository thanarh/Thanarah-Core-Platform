export const PatientStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
} as const;

export type PatientStatus = (typeof PatientStatus)[keyof typeof PatientStatus];

export interface PatientPortalClaim {
  operationId: string;
  accountUserId: string;
  codeDigest: string;
  createdAt: Date;
  expiresAt: Date;
  attempts: number;
  consentAcceptedAt: Date;
}

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
  portalAccountUserId?: string | null;
  portalLinkedAt?: Date | null;
  portalClaim?: PatientPortalClaim | null;
  status: PatientStatus;
  createdAt: Date;
  updatedAt: Date;
}

export type PatientDuplicateIdentity = Pick<
  PatientRecord,
  'firstName' | 'middleName' | 'lastName' | 'dateOfBirth' | 'phone' | 'email'
>;

export interface PatientDirectoryRecord {
  id: string;
  patientNumber: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  preferredName: string | null;
  phone: string | null;
  email: string | null;
  status: PatientStatus;
}

export const PATIENT_DIRECTORY_SEARCH_FIELDS = [
  'patientNumber',
  'firstName',
  'middleName',
  'lastName',
  'preferredName',
  'phone',
  'email',
] as const satisfies readonly (keyof PatientRecord)[];

export type PatientMutationResult =
  | { kind: 'changed'; record: PatientRecord }
  | { kind: 'not-found' }
  | { kind: 'patient-number-conflict' }
  | { kind: 'possible-duplicate' };

export type PatientLifecycleMutationResult =
  { kind: 'changed'; record: PatientRecord } | { kind: 'not-found' } | { kind: 'not-changed' };
