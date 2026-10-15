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
    doctorId: appointmentIdSchema.optional(),
    facilityId: appointmentIdSchema.optional(),
    branchId: appointmentIdSchema.optional(),
    patientId: appointmentIdSchema.optional(),
    status: z.enum([AppointmentStatus.SCHEDULED, AppointmentStatus.CANCELLED]).optional(),
    limit: listIntegerSchema(1, 100).default(50),
    offset: listIntegerSchema(0, 100_000).default(0),
  })
  .strict()
  .refine((query) => query.from === undefined || query.to === undefined || query.from < query.to, {
    message: 'from must be earlier than to',
    path: ['to'],
  });

export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;
export type UpdateAppointmentInput = z.infer<typeof updateAppointmentSchema>;
export type RescheduleAppointmentInput = z.infer<typeof rescheduleAppointmentSchema>;
export type ListAppointmentsQuery = z.infer<typeof listAppointmentsQuerySchema>;
