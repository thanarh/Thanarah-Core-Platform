import { SubscriptionStatus } from '@prisma/client';
import { z } from 'zod';

export const subscriptionIdSchema = z.string().uuid();
const tenantIdSchema = z.string().uuid();
const planIdSchema = z.string().uuid();
const utcDateTimeSchema = z.string().datetime({ offset: false });

export const createSubscriptionSchema = z
  .object({
    tenantId: tenantIdSchema,
    planId: planIdSchema,
    startsAt: utcDateTimeSchema,
    endsAt: utcDateTimeSchema.optional(),
  })
  .strict()
  .refine(
    ({ startsAt, endsAt }) =>
      endsAt === undefined || new Date(endsAt).getTime() >= new Date(startsAt).getTime(),
    { path: ['endsAt'], message: 'endsAt must not be earlier than startsAt' },
  );

export const listSubscriptionsQuerySchema = z
  .object({
    tenantId: tenantIdSchema.optional(),
    status: z.nativeEnum(SubscriptionStatus).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
  })
  .strict();

export const currentSubscriptionQuerySchema = z.object({ tenantId: tenantIdSchema }).strict();

export type CreateSubscriptionInput = z.infer<typeof createSubscriptionSchema>;
export type ListSubscriptionsQuery = z.infer<typeof listSubscriptionsQuerySchema>;
export type CurrentSubscriptionQuery = z.infer<typeof currentSubscriptionQuerySchema>;
