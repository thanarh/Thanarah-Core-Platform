import { PatientStatus } from '@prisma/client';
import { z } from 'zod';

export const MAX_PATIENT_LIST_OFFSET = 100_000;

function normalizePatientName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
}

const patientNameSchema = z
  .string()
  .transform(normalizePatientName)
  .pipe(z.string().min(1).max(191));

const optionalNullableNameSchema = patientNameSchema.nullable().optional();

const patientNumberSchema = z
  .string()
  .transform((value) => value.normalize('NFKC').trim())
  .pipe(z.string().min(1).max(64));

const patientEmailSchema = z
  .string()
  .transform((value) => value.normalize('NFKC').trim().toLowerCase())
  .pipe(z.string().min(1).max(191).email());

const patientPhoneSchema = z
  .string()
  .transform((value) => value.normalize('NFKC').trim().replace(/\s+/gu, ' '))
  .pipe(
    z
      .string()
      .min(1)
      .max(32)
      .regex(/^\+?[0-9](?:[0-9 ().-]*[0-9])?$/u),
  )
  .refine((value) => {
    const digits = value.replace(/\D/gu, '').length;
    return digits >= 5 && digits <= 15;
  });

const patientOptionalTextSchema = (maxLength: number): z.ZodType<string, z.ZodTypeDef, string> =>
  z
    .string()
    .transform((value) => value.normalize('NFKC').trim())
    .pipe(z.string().min(1).max(maxLength));

const patientDateOfBirthStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
  .refine((value) => {
    const year = Number(value.slice(0, 4));
    if (year < 1000) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  })
  .refine((value) => value <= new Date().toISOString().slice(0, 10))
  .transform((value) => new Date(`${value}T00:00:00.000Z`));

const patientDateOfBirthDateSchema = z
  .date()
  .refine((value) => value.toISOString().slice(0, 4) >= '1000')
  .refine((value) => value.toISOString().slice(0, 10) <= new Date().toISOString().slice(0, 10));

const patientDateOfBirthSchema = z.union([
  patientDateOfBirthStringSchema,
  patientDateOfBirthDateSchema,
]);

const patientAddressSchema = z
  .string()
  .transform((value) => value.normalize('NFKC').replace(/\r\n?/gu, '\n').trim())
  .pipe(z.string().min(1).max(2000))
  .refine((value) => !/<\/?[a-z][^>]*>/iu.test(value), {
    message: 'Address must contain plain text, not HTML markup',
  });

const patientListIntegerSchema = (
  minimum: number,
  maximum: number,
): z.ZodType<number, z.ZodTypeDef, number | string> =>
  z
    .union([z.number().int(), z.string().regex(/^\d+$/u).transform(Number)])
    .pipe(z.number().int().min(minimum).max(maximum));

export const createPatientSchema = z
  .object({
    patientNumber: patientNumberSchema,
    firstName: patientNameSchema,
    middleName: optionalNullableNameSchema,
    lastName: patientNameSchema,
    preferredName: optionalNullableNameSchema,
    dateOfBirth: patientDateOfBirthSchema.nullable().optional(),
    gender: patientOptionalTextSchema(32).nullable().optional(),
    phone: patientPhoneSchema.nullable().optional(),
    email: patientEmailSchema.nullable().optional(),
    nationalId: patientOptionalTextSchema(64).nullable().optional(),
    address: patientAddressSchema.nullable().optional(),
  })
  .strict();

export const updatePatientSchema = z
  .object({
    patientNumber: patientNumberSchema.optional(),
    firstName: patientNameSchema.optional(),
    middleName: optionalNullableNameSchema,
    lastName: patientNameSchema.optional(),
    preferredName: optionalNullableNameSchema,
    dateOfBirth: patientDateOfBirthSchema.nullable().optional(),
    gender: patientOptionalTextSchema(32).nullable().optional(),
    phone: patientPhoneSchema.nullable().optional(),
    email: patientEmailSchema.nullable().optional(),
    nationalId: patientOptionalTextSchema(64).nullable().optional(),
    address: patientAddressSchema.nullable().optional(),
  })
  .strict()
  .refine((patient) => Object.values(patient).some((value) => value !== undefined));

export const listPatientsQuerySchema = z
  .object({
    status: z.nativeEnum(PatientStatus).optional(),
    patientNumber: patientNumberSchema.optional(),
    limit: patientListIntegerSchema(1, 100).default(50),
    offset: patientListIntegerSchema(0, MAX_PATIENT_LIST_OFFSET).default(0),
  })
  .strict();

export const patientIdSchema = z
  .string()
  .uuid()
  .transform((id) => id.toLowerCase());

export type CreatePatientInput = z.infer<typeof createPatientSchema>;
export type UpdatePatientInput = z.infer<typeof updatePatientSchema>;
export type ListPatientsQuery = z.infer<typeof listPatientsQuerySchema>;
