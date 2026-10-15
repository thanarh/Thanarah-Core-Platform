import { z } from 'zod';
import { AppointmentStatus } from './appointment.model';

export const appointmentIdSchema = z
  .string()
  .uuid()
  .transform((id) => id.toLowerCase());

export const appointmentIdempotencyKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[\x21-\x7e]+$/u);

const appointmentTimestampStringSchema = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value));

const appointmentTimestampSchema = z
  .union([appointmentTimestampStringSchema, z.date()])
  .transform((value) => new Date(value));

const appointmentReasonSchema = z
  .string()
  .transform((value) => value.normalize('NFKC').replace(/\r\n?/gu, '\n').trim())
  .pipe(z.string().min(1).max(500))
  .refine((value) => !/<\/?[a-z][^>]*>/iu.test(value), {
    message: 'Reason must contain plain text, not HTML markup',
  });

export const createAppointmentSchema = z
  .object({
    patientId: appointmentIdSchema,
    doctorId: appointmentIdSchema,
    facilityId: appointmentIdSchema,
    branchId: appointmentIdSchema.optional(),
    serviceId: appointmentIdSchema.optional(),
    startsAt: appointmentTimestampSchema,
    endsAt: appointmentTimestampSchema,
    reason: appointmentReasonSchema.nullable().optional(),
  })
  .strict()
  .refine((value) => value.endsAt.getTime() > value.startsAt.getTime(), {
    message: 'End time must be later than start time',
    path: ['endsAt'],
  });

export const updateAppointmentSchema = z
  .object({
    patientId: appointmentIdSchema.optional(),
    serviceId: appointmentIdSchema.nullable().optional(),
    reason: appointmentReasonSchema.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined));

export const rescheduleAppointmentSchema = z
  .object({
    startsAt: appointmentTimestampSchema,
    endsAt: appointmentTimestampSchema,
    doctorId: appointmentIdSchema.optional(),
    facilityId: appointmentIdSchema.optional(),
    branchId: appointmentIdSchema.nullable().optional(),
  })
  .strict()
  .refine((value) => value.endsAt.getTime() > value.startsAt.getTime(), {
    message: 'End time must be later than start time',
    path: ['endsAt'],
  });

const appointmentSearchSchema = z
  .string()
  .max(128)
  .transform((value) => value.normalize('NFKC').trim().replace(/\s+/gu, ' '))
  .pipe(z.string().max(128))
  .transform((value) => value || undefined)
  .optional();

const appointmentLocalDateSchema = z
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

const listIntegerSchema = (
  minimum: number,
  maximum: number,
): z.ZodType<number, z.ZodTypeDef, number | string> =>
  z
    .union([z.number().int(), z.string().regex(/^\d+$/u).transform(Number)])
    .pipe(z.number().int().min(minimum).max(maximum));

export const listAppointmentsQuerySchema = z
  .object({
    from: appointmentTimestampSchema.optional(),
    to: appointmentTimestampSchema.optional(),
    fromDate: appointmentLocalDateSchema.optional(),
    toDate: appointmentLocalDateSchema.optional(),
    search: appointmentSearchSchema,
    doctorId: appointmentIdSchema.optional(),
    facilityId: appointmentIdSchema.optional(),
    branchId: appointmentIdSchema.optional(),
    patientId: appointmentIdSchema.optional(),
    serviceId: appointmentIdSchema.optional(),
    status: z.enum([AppointmentStatus.SCHEDULED, AppointmentStatus.CANCELLED]).optional(),
    limit: listIntegerSchema(1, 100).default(50),
    offset: listIntegerSchema(0, 100_000).default(0),
  })
  .strict()
  .superRefine((query, context) => {
    if (query.from && query.to && query.from >= query.to) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'from must be earlier than to',
        path: ['to'],
      });
    }
    if ((query.fromDate || query.toDate) && !query.facilityId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A facility is required for local-date filtering',
        path: ['facilityId'],
      });
    }
    if ((query.fromDate || query.toDate) && (query.from || query.to)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Use either explicit timestamps or local dates, not both',
        path: ['fromDate'],
      });
    }
    if (query.fromDate && query.toDate && query.fromDate > query.toDate) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'fromDate must not be later than toDate',
        path: ['toDate'],
      });
    }
  });

export const appointmentEffectiveTimeZonesQuerySchema = z
  .object({
    facilityIds: z
      .string()
      .max(20 * 36 + 19)
      .transform((value) => value.split(',').map((facilityId) => facilityId.trim()))
      .pipe(z.array(appointmentIdSchema).min(1).max(20))
      .transform((facilityIds) => [...new Set(facilityIds)]),
  })
  .strict();

export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;
export type UpdateAppointmentInput = z.infer<typeof updateAppointmentSchema>;
export type RescheduleAppointmentInput = z.infer<typeof rescheduleAppointmentSchema>;
export type ListAppointmentsQuery = z.infer<typeof listAppointmentsQuerySchema>;
export type AppointmentEffectiveTimeZonesQuery = z.infer<
  typeof appointmentEffectiveTimeZonesQuerySchema
>;
