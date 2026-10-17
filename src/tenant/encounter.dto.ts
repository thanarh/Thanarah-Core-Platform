import { z } from 'zod';
import { EncounterStatus } from './encounter.model';

export const encounterIdSchema = z
  .string()
  .uuid()
  .transform((id) => id.toLowerCase());

const encounterTextSchema = z
  .string()
  .transform((value) => value.normalize('NFKC').replace(/\r\n?/gu, '\n').trim())
  .pipe(
    z
      .string()
      .min(1)
      .max(8_000)
      .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)),
  );

const encounterFactSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('UNKNOWN') }).strict(),
  z.object({ status: z.literal('NEGATIVE') }).strict(),
  z.object({ status: z.literal('DOCUMENTED'), text: encounterTextSchema }).strict(),
]);

const measurementSchema = <T extends string>(
  unit: T,
  minimum = 0,
  maximum = 1_000,
): z.ZodObject<{ value: z.ZodNumber; unit: z.ZodLiteral<T> }> =>
  z
    .object({
      value: z.number().finite().min(minimum).max(maximum),
      unit: z.literal(unit),
    })
    .strict();

const temperatureSchema = z.discriminatedUnion('unit', [
  z.object({ value: z.number().finite().min(-100).max(200), unit: z.literal('°C') }).strict(),
  z.object({ value: z.number().finite().min(-148).max(392), unit: z.literal('°F') }).strict(),
]);

const measurementSchemas = {
  systolicBloodPressure: measurementSchema('mmHg'),
  diastolicBloodPressure: measurementSchema('mmHg'),
  heartRate: measurementSchema('bpm'),
  respiratoryRate: measurementSchema('breaths/min'),
  temperature: temperatureSchema,
  oxygenSaturation: measurementSchema('%', 0, 100),
  height: measurementSchema('cm', 0, 1_000),
  weight: measurementSchema('kg', 0, 10_000),
};

const vitalSignsPatchSchema = z
  .object({
    systolicBloodPressure: measurementSchemas.systolicBloodPressure.nullable().optional(),
    diastolicBloodPressure: measurementSchemas.diastolicBloodPressure.nullable().optional(),
    heartRate: measurementSchemas.heartRate.nullable().optional(),
    respiratoryRate: measurementSchemas.respiratoryRate.nullable().optional(),
    temperature: measurementSchemas.temperature.nullable().optional(),
    oxygenSaturation: measurementSchemas.oxygenSaturation.nullable().optional(),
    height: measurementSchemas.height.nullable().optional(),
    weight: measurementSchemas.weight.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one vital is required' });

const clinicalRecordPatchSchema = z
  .object({
    reason: encounterTextSchema.nullable().optional(),
    chiefComplaint: encounterTextSchema.nullable().optional(),
    historyOfPresentIllness: encounterTextSchema.nullable().optional(),
    medicalHistory: encounterFactSchema.nullable().optional(),
    allergies: encounterFactSchema.nullable().optional(),
    medicationHistory: encounterFactSchema.nullable().optional(),
    reviewOfSystems: encounterFactSchema.nullable().optional(),
    vitalSigns: vitalSignsPatchSchema.nullable().optional(),
    examinationFindings: encounterTextSchema.nullable().optional(),
    assessment: encounterTextSchema.nullable().optional(),
    plan: encounterTextSchema.nullable().optional(),
    followUp: encounterTextSchema.nullable().optional(),
    internalNotes: encounterTextSchema.nullable().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (Object.keys(value).length === 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Clinical changes are required' });
    }
    if (value.vitalSigns && Object.keys(value.vitalSigns).length === 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Vital changes are required' });
    }
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 48_000) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Clinical payload is too large' });
    }
  });

const expectedVersionSchema = z.number().int().min(1).max(2_147_483_647);

export const createEncounterFromAppointmentSchema = z
  .object({ appointmentId: encounterIdSchema })
  .strict();

export const createDirectEncounterSchema = z
  .object({
    patientId: encounterIdSchema,
    doctorId: encounterIdSchema,
    facilityId: encounterIdSchema,
    branchId: encounterIdSchema.optional(),
  })
  .strict();

const encounterDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
  .refine((value) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
    if (!match) return false;
    const [year, month, day] = match.slice(1).map(Number);
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    date.setUTCHours(0, 0, 0, 0);
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  });

const encounterTimestampSchema = z.union([
  z
    .string()
    .datetime({ offset: true })
    .transform((value) => new Date(value)),
  z.date(),
]);

const listIntegerSchema = (
  minimum: number,
  maximum: number,
): z.ZodType<number, z.ZodTypeDef, number | string> =>
  z
    .union([z.number().int(), z.string().regex(/^\d+$/u).transform(Number)])
    .pipe(z.number().int().min(minimum).max(maximum));

export const listEncountersQuerySchema = z
  .object({
    search: encounterIdSchema.optional(),
    appointmentId: encounterIdSchema.optional(),
    patientId: encounterIdSchema.optional(),
    doctorId: encounterIdSchema.optional(),
    facilityId: encounterIdSchema.optional(),
    branchId: encounterIdSchema.optional(),
    status: z
      .enum([EncounterStatus.DRAFT, EncounterStatus.COMPLETED, EncounterStatus.CANCELLED])
      .optional(),
    from: encounterTimestampSchema.optional(),
    to: encounterTimestampSchema.optional(),
    fromDate: encounterDateSchema.optional(),
    toDate: encounterDateSchema.optional(),
    limit: listIntegerSchema(1, 100).default(50),
    offset: listIntegerSchema(0, 100_000).default(0),
  })
  .strict()
  .superRefine((query, context) => {
    if (query.from && query.to && query.from >= query.to) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'from must be earlier than to' });
    }
    if ((query.fromDate || query.toDate) && !query.facilityId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A facility is required for local-date filtering',
      });
    }
    if ((query.fromDate || query.toDate) && (query.from || query.to)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Use either explicit timestamps or local dates, not both',
      });
    }
    if (query.branchId && !query.facilityId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A facility is required when filtering by branch',
      });
    }
    if (query.fromDate && query.toDate && query.fromDate > query.toDate) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'fromDate must not exceed toDate' });
    }
  });

export const updateEncounterSchema = z
  .object({ expectedVersion: expectedVersionSchema, clinical: clinicalRecordPatchSchema })
  .strict();

const diagnosisDescriptionSchema = z
  .string()
  .transform((value) => value.normalize('NFKC').replace(/\r\n?/gu, '\n').trim())
  .pipe(
    z
      .string()
      .min(1)
      .max(2_000)
      .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)),
  );

const serviceNoteSchema = z
  .string()
  .transform((value) => value.normalize('NFKC').replace(/\r\n?/gu, '\n').trim())
  .pipe(
    z
      .string()
      .min(1)
      .max(3_000)
      .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)),
  );

const clinicalInstantSchema = encounterTimestampSchema;

const diagnosisEntrySchema = z
  .object({
    id: encounterIdSchema.optional(),
    description: diagnosisDescriptionSchema,
    priority: z.enum(['PRIMARY', 'SECONDARY']),
    clinicalStatus: z.enum(['ACTIVE', 'RESOLVED', 'INACTIVE']),
    onsetAt: clinicalInstantSchema.nullable().optional(),
  })
  .strict();

const serviceRecordEntrySchema = z
  .object({
    id: encounterIdSchema.optional(),
    serviceId: encounterIdSchema,
    providerDoctorId: encounterIdSchema.optional(),
    status: z.enum(['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
    note: serviceNoteSchema.nullable().optional(),
  })
  .strict();

const replaceDiagnosesSchema = z
  .object({
    expectedVersion: expectedVersionSchema,
    diagnoses: z.array(diagnosisEntrySchema).max(100),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.diagnoses.filter((diagnosis) => diagnosis.priority === 'PRIMARY').length !==
      (value.diagnoses.length ? 1 : 0)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A non-empty diagnosis list must have exactly one primary diagnosis',
      });
    }
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 48_000) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Diagnosis payload is too large' });
    }
  });

const replaceServiceRecordsSchema = z
  .object({
    expectedVersion: expectedVersionSchema,
    serviceRecords: z.array(serviceRecordEntrySchema).max(50),
  })
  .strict()
  .superRefine((value, context) => {
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 48_000) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Service record payload is too large',
      });
    }
  });

const amendmentReasonSchema = z
  .string()
  .transform((value) => value.normalize('NFKC').replace(/\r\n?/gu, '\n').trim())
  .pipe(
    z
      .string()
      .min(1)
      .max(1_000)
      .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)),
  );

const createAmendmentSchema = z
  .object({ expectedVersion: expectedVersionSchema, reason: amendmentReasonSchema })
  .strict();

const updateAmendmentSchema = z
  .object({
    expectedVersion: expectedVersionSchema,
    clinical: clinicalRecordPatchSchema.optional(),
    diagnoses: z.array(diagnosisEntrySchema).max(100).optional(),
    serviceRecords: z.array(serviceRecordEntrySchema).max(50).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.clinical === undefined &&
      value.diagnoses === undefined &&
      value.serviceRecords === undefined
    ) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Amendment changes are required' });
    }
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 48_000) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Amendment payload is too large' });
    }
  });

const finalizeAmendmentSchema = z.object({ expectedVersion: expectedVersionSchema }).strict();

export const completeEncounterSchema = z
  .object({ expectedVersion: expectedVersionSchema })
  .strict();

export const cancelEncounterSchema = z
  .object({
    expectedVersion: expectedVersionSchema,
    reason: z
      .string()
      .transform((value) => value.normalize('NFKC').replace(/\r\n?/gu, '\n').trim())
      .pipe(z.string().min(1).max(500))
      .optional(),
  })
  .strict();

export const encounterEffectiveTimeZonesQuerySchema = z
  .object({
    facilityIds: z
      .union([
        z
          .string()
          .max(1_024)
          .transform((value) =>
            value
              .split(',')
              .map((id) => id.trim())
              .filter(Boolean),
          ),
        z.array(z.string().uuid()),
      ])
      .pipe(z.array(z.string().uuid()).min(1).max(20))
      .transform((ids) => [...new Set(ids.map((id) => id.toLowerCase()))]),
  })
  .strict();

export type CreateEncounterFromAppointmentInput = z.infer<
  typeof createEncounterFromAppointmentSchema
>;
export type CreateDirectEncounterInput = z.infer<typeof createDirectEncounterSchema>;
export type ListEncountersQuery = z.input<typeof listEncountersQuerySchema>;
export type UpdateEncounterInput = z.infer<typeof updateEncounterSchema>;
export const replaceEncounterDiagnosesSchema = replaceDiagnosesSchema;
export const replaceEncounterServiceRecordsSchema = replaceServiceRecordsSchema;
export const createEncounterAmendmentSchema = createAmendmentSchema;
export const updateEncounterAmendmentSchema = updateAmendmentSchema;
export const finalizeEncounterAmendmentSchema = finalizeAmendmentSchema;
export type ReplaceEncounterDiagnosesInput = z.infer<typeof replaceDiagnosesSchema>;
export type ReplaceEncounterServiceRecordsInput = z.infer<typeof replaceServiceRecordsSchema>;
export type CreateEncounterAmendmentInput = z.infer<typeof createAmendmentSchema>;
export type UpdateEncounterAmendmentInput = z.infer<typeof updateAmendmentSchema>;
export type FinalizeEncounterAmendmentInput = z.infer<typeof finalizeAmendmentSchema>;
export type CompleteEncounterInput = z.infer<typeof completeEncounterSchema>;
export type CancelEncounterInput = z.infer<typeof cancelEncounterSchema>;
export type EncounterEffectiveTimeZonesQuery = z.input<
  typeof encounterEffectiveTimeZonesQuerySchema
>;
export type EncounterClinicalPatch = z.infer<typeof clinicalRecordPatchSchema>;
