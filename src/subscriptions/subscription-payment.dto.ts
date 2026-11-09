import { z } from 'zod';

const idSchema = z.string().uuid();

const bankSettingsFields = {
  enabled: z.boolean(),
  bankName: z.string().trim().min(1).max(100).nullable(),
  accountHolder: z.string().trim().min(1).max(191).nullable(),
  iban: z.string().trim().min(8).max(64).nullable(),
  currencyCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/u)
    .nullable(),
};

export const updateSubscriptionPaymentSettingsSchema = z
  .object({
    expectedVersion: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    ...bankSettingsFields,
  })
  .strict()
  .refine(
    (value) =>
      !value.enabled ||
      Boolean(value.bankName && value.accountHolder && value.iban && value.currencyCode),
  );

export const subscriptionTransferListSchema = z
  .object({
    tenantId: idSchema.optional(),
    subscriptionId: idSchema.optional(),
    status: z.enum(['PENDING_REVIEW', 'APPROVED', 'REJECTED']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
  })
  .strict();

export const subscriptionTransferIdSchema = idSchema;

export const reviewSubscriptionTransferSchema = z
  .object({
    expectedVersion: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

export const subscriptionTransferAmountSchema = z
  .object({
    amountMinor: z
      .string()
      .regex(/^[1-9]\d{0,17}$/u)
      .optional(),
    currencyCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/u)
      .optional(),
  })
  .strict()
  .refine((value) => Boolean(value.amountMinor) === Boolean(value.currencyCode));

export type UpdateSubscriptionPaymentSettingsInput = z.infer<
  typeof updateSubscriptionPaymentSettingsSchema
>;
export type SubscriptionTransferListInput = z.infer<typeof subscriptionTransferListSchema>;
export type ReviewSubscriptionTransferInput = z.infer<typeof reviewSubscriptionTransferSchema>;
