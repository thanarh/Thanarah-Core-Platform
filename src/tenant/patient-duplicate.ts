import { normalizePatientEmail, normalizePatientName, normalizePatientPhone } from './patient.dto';
import type { PatientDuplicateIdentity } from './patient.model';

/**
 * Name comparisons are case-insensitive through this collation. It is shared
 * by the duplicate queries and their compound indexes.
 */
export const PATIENT_DUPLICATE_COLLATION = { locale: 'en', strength: 2 } as const;

/**
 * Values are normalized for comparison only. Phone punctuation and the leading
 * plus sign remain significant; no country-specific phone rules are assumed.
 */
export function normalizePatientDuplicateIdentity(
  identity: PatientDuplicateIdentity,
): PatientDuplicateIdentity {
  return {
    firstName: normalizePatientName(identity.firstName).toLowerCase(),
    middleName:
      identity.middleName === null ? null : normalizePatientName(identity.middleName).toLowerCase(),
    lastName: normalizePatientName(identity.lastName).toLowerCase(),
    dateOfBirth: normalizePatientDateOfBirth(identity.dateOfBirth),
    phone: identity.phone === null ? null : normalizePatientPhone(identity.phone),
    email: identity.email === null ? null : normalizePatientEmail(identity.email),
  };
}

export function hasPotentialPatientDuplicate(
  candidate: PatientDuplicateIdentity,
  existing: PatientDuplicateIdentity,
): boolean {
  const left = normalizePatientDuplicateIdentity(candidate);
  const right = normalizePatientDuplicateIdentity(existing);
  const sameFullName =
    left.firstName === right.firstName &&
    left.middleName === right.middleName &&
    left.lastName === right.lastName;

  return (
    (left.phone !== null && left.phone === right.phone && sameFullName) ||
    (left.email !== null && left.email === right.email && sameFullName) ||
    (left.dateOfBirth !== null &&
      right.dateOfBirth !== null &&
      left.firstName === right.firstName &&
      left.lastName === right.lastName &&
      left.dateOfBirth.getTime() === right.dateOfBirth.getTime())
  );
}

function normalizePatientDateOfBirth(value: Date | null): Date | null {
  if (value === null) return null;
  return new Date(`${value.toISOString().slice(0, 10)}T00:00:00.000Z`);
}
