import { z } from 'zod';

export const SCHEDULING_WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

const weekdaySchema = z.enum(SCHEDULING_WEEKDAYS);
const idSchema = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
const clockStartSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u);
const clockEndSchema = z.string().regex(/^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/u);

const intervalSchema = z
  .object({
    start: clockStartSchema,
    end: clockEndSchema,
  })
  .strict()
  .refine((interval) => clockMinutes(interval.end) > clockMinutes(interval.start));

const intervalsSchema = z
  .array(intervalSchema)
  .max(12)
  .superRefine((intervals, context) => {
    const ordered = [...intervals].sort(
      (left, right) => clockMinutes(left.start) - clockMinutes(right.start),
    );
    for (let index = 1; index < ordered.length; index += 1) {
      if (clockMinutes(ordered[index - 1].end) > clockMinutes(ordered[index].start)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Operating intervals cannot overlap',
        });
      }
    }
  });

const weeklyScheduleSchema = z
  .object({
    monday: intervalsSchema.optional(),
    tuesday: intervalsSchema.optional(),
    wednesday: intervalsSchema.optional(),
    thursday: intervalsSchema.optional(),
    friday: intervalsSchema.optional(),
    saturday: intervalsSchema.optional(),
    sunday: intervalsSchema.optional(),
  })
  .strict();

const uniquePositiveDurations = z
  .array(z.number().int().min(1).max(1440))
  .max(1440)
  .refine((values) => new Set(values).size === values.length);

const nonEmptyUniquePositiveDurations = z
  .array(z.number().int().min(1).max(1440))
  .min(1)
  .max(1440)
  .refine((values) => new Set(values).size === values.length);

const providerExceptionSchema = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u)
      .refine(isCalendarDate),
    intervals: intervalsSchema,
  })
  .strict();

const providerAvailabilitySchema = z
  .array(
    z
      .object({
        doctorId: idSchema,
        weeklyAvailability: weeklyScheduleSchema,
        exceptions: z.array(providerExceptionSchema).max(366).default([]),
      })
      .strict()
      .superRefine((provider, context) => {
        const dates = provider.exceptions.map(({ date }) => date);
        if (new Set(dates).size !== dates.length) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['exceptions'],
            message: 'Provider exception dates must be unique',
          });
        }
      }),
  )
  .max(1000)
  .superRefine((providers, context) => {
    const ids = providers.map(({ doctorId }) => doctorId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provider availability entries must be unique',
      });
    }
  });

const serviceDurationRulesSchema = z
  .array(
    z
      .object({
        serviceId: idSchema,
        allowedDurationsMinutes: nonEmptyUniquePositiveDurations,
      })
      .strict(),
  )
  .max(500)
  .superRefine((rules, context) => {
    const ids = rules.map(({ serviceId }) => serviceId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Service duration rules must be unique',
      });
    }
  });

const nullableMinutesSchema = z.number().int().min(0).max(5_256_000).nullable();

export const schedulingPolicyRulesSchema = z
  .object({
    operatingHours: weeklyScheduleSchema.default({}),
    providerAvailability: providerAvailabilitySchema.default([]),
    allowedDurationsMinutes: uniquePositiveDurations.default([]),
    serviceDurationRules: serviceDurationRulesSchema.default([]),
    bookingHorizonDays: z.number().int().min(0).max(3650).nullable().default(null),
    minimumAdvanceNoticeMinutes: nullableMinutesSchema.default(null),
    minimumCancellationNoticeMinutes: nullableMinutesSchema.default(null),
    minimumRescheduleNoticeMinutes: nullableMinutesSchema.default(null),
  })
  .strict();

export const facilitySchedulingPolicyIdSchema = idSchema;

export const schedulingPolicyInputSchema = z
  .object({
    timeZone: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .refine(isValidIanaTimeZone)
      .transform(canonicalTimeZone),
    rules: schedulingPolicyRulesSchema,
    expectedVersion: z.number().int().positive().optional(),
  })
  .strict();

export const schedulingPolicyTransitionSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
  })
  .strict();

export type SchedulingPolicyRules = z.infer<typeof schedulingPolicyRulesSchema>;
export type SchedulingPolicyInput = z.infer<typeof schedulingPolicyInputSchema>;

function clockMinutes(value: string): number {
  if (value === '24:00') return 1440;
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function isCalendarDate(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export function isValidIanaTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function canonicalTimeZone(value: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone;
}

export { weekdaySchema };
