import { z } from 'zod';
import { isSupportedCurrencyCode } from './clinic-finance.calculation';

const roundingSchema = z.enum(['HALF_UP', 'DOWN', 'UP']);
const invoiceIdSchema = z.string().uuid();
const fieldKeySchema = z.string().regex(/^[a-z][a-zA-Z0-9_]{0,31}$/u);
const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  });

const customFieldSchema = z.object({
  key: fieldKeySchema,
  label: z.string().trim().min(1).max(100),
  type: z.enum(['TEXT', 'DATE', 'BOOLEAN']),
  required: z.boolean(),
});

const noTaxPolicySchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  type: z.literal('NO_TAX'),
});

const rateTaxPolicySchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  type: z.literal('RATE'),
  rateBasisPoints: z.number().int().min(1).max(1_000_000),
  calculation: z.enum(['PER_LINE', 'SUBTOTAL']),
  rounding: roundingSchema,
});

const numberingPolicySchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('MANUAL'),
    prefix: z.string().max(24),
    minimumDigits: z.number().int().min(1).max(12),
  }),
  z.object({
    mode: z.literal('SEQUENTIAL'),
    prefix: z.string().max(24),
    minimumDigits: z.number().int().min(1).max(12),
    startingNumber: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  }),
]);

const bankTransferSchema = z
  .object({
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
  })
  .strict();

export const updateClinicPaymentSettingsSchema = z
  .object({
    expectedVersion: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    bankTransfer: bankTransferSchema,
  })
  .strict();

export const updateClinicFinanceSettingsSchema = z.object({
  expectedVersion: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  currencyCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/u)
    .refine(isSupportedCurrencyCode),
  lineRounding: roundingSchema.nullable(),
  customFields: z.array(customFieldSchema).max(20),
  taxPolicies: z.array(z.union([noTaxPolicySchema, rateTaxPolicySchema])).max(20),
  numberingPolicy: numberingPolicySchema.nullable(),
});

const lineSchema = z.object({
  id: z.string().uuid(),
  description: z.string().trim().min(1).max(256),
  quantityMilli: z.number().int().min(1).max(1_000_000),
  unitPriceMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});

const customValuesSchema = z.record(z.string(), z.union([z.string().max(1000), z.boolean()]));

export const createClinicInvoiceSchema = z.object({
  patientId: z.string().uuid().nullable().optional(),
  recipientName: z.string().trim().min(1).max(191),
  invoiceDate: dateOnlySchema,
  customFieldValues: customValuesSchema.default({}),
  taxPolicyId: z.string().uuid().nullable().optional(),
  manualInvoiceNumber: z.string().trim().min(1).max(64).nullable().optional(),
  lines: z.array(lineSchema).min(1).max(50),
});

export const updateClinicInvoiceSchema = z
  .object({
    expectedVersion: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    currencyCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/u)
      .refine(isSupportedCurrencyCode)
      .optional(),
    patientId: z.string().uuid().nullable().optional(),
    recipientName: z.string().trim().min(1).max(191).optional(),
    invoiceDate: dateOnlySchema.optional(),
    customFieldValues: customValuesSchema.optional(),
    taxPolicyId: z.string().uuid().nullable().optional(),
    manualInvoiceNumber: z.string().trim().min(1).max(64).nullable().optional(),
    lines: z.array(lineSchema).min(1).max(50).optional(),
  })
  .refine(({ expectedVersion: _expectedVersion, ...fields }) => Object.keys(fields).length > 0);

export const clinicInvoiceIdSchema = invoiceIdSchema;
export const clinicInvoiceTransferIdSchema = z.string().uuid();
export const clinicInvoiceTransferStatusSchema = z.enum(['PENDING_REVIEW', 'APPROVED', 'REJECTED']);

export const reviewClinicInvoiceTransferSchema = z.object({
  expectedVersion: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  reason: z.string().trim().min(3).max(500),
});

export const clinicInvoiceTransitionSchema = z.object({
  expectedVersion: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
});

export const returnClinicInvoiceToDraftSchema = z.object({
  expectedVersion: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  reason: z.string().trim().min(1).max(500),
});

export const listClinicInvoicesQuerySchema = z.object({
  status: z.enum(['DRAFT', 'REVIEWED', 'ISSUED']).optional(),
  search: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export type UpdateClinicFinanceSettingsInput = z.infer<typeof updateClinicFinanceSettingsSchema>;
export type UpdateClinicPaymentSettingsInput = z.infer<typeof updateClinicPaymentSettingsSchema>;
export type CreateClinicInvoiceInput = z.infer<typeof createClinicInvoiceSchema>;
export type UpdateClinicInvoiceInput = z.infer<typeof updateClinicInvoiceSchema>;
export type ListClinicInvoicesQuery = z.infer<typeof listClinicInvoicesQuerySchema>;
