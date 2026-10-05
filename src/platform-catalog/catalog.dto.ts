import { FeatureStatus, PlanStatus } from '@prisma/client';
import { z } from 'zod';

function normalizeCatalogKey(value: string): string {
  return value.normalize('NFKC').trim().toUpperCase();
}

function normalizeCatalogName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
}

function normalizeDescription(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
}

const catalogKeySchema = z
  .string()
  .transform(normalizeCatalogKey)
  .pipe(
    z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Z][A-Z0-9_]*$/),
  );
const catalogNameSchema = z
  .string()
  .transform(normalizeCatalogName)
  .pipe(z.string().min(1).max(191));
const descriptionSchema = z.string().transform(normalizeDescription).pipe(z.string().max(1000));

export const planIdSchema = z.string().uuid();
export const featureIdSchema = z.string().uuid();

export const createPlanSchema = z
  .object({
    key: catalogKeySchema,
    name: catalogNameSchema,
    description: descriptionSchema.optional(),
  })
  .strict();

export const updatePlanSchema = z
  .object({
    name: catalogNameSchema.optional(),
    description: descriptionSchema.nullable().optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0);

export const changePlanStatusSchema = z.object({ status: z.nativeEnum(PlanStatus) }).strict();

export const listPlansQuerySchema = z
  .object({
    status: z.nativeEnum(PlanStatus).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
  })
  .strict();

export const createFeatureSchema = z
  .object({
    key: catalogKeySchema,
    name: catalogNameSchema,
    description: descriptionSchema.optional(),
  })
  .strict();

export const updateFeatureSchema = z
  .object({
    name: catalogNameSchema.optional(),
    description: descriptionSchema.nullable().optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0);

export const changeFeatureStatusSchema = z.object({ status: z.nativeEnum(FeatureStatus) }).strict();

export const listFeaturesQuerySchema = z
  .object({
    status: z.nativeEnum(FeatureStatus).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
  })
  .strict();

export const updatePlanFeatureSchema = z.object({ enabled: z.boolean() }).strict();

export const attachPlanFeatureSchema = z.object({ featureId: featureIdSchema }).strict();

export type CreatePlanInput = z.infer<typeof createPlanSchema>;
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;
export type ChangePlanStatusInput = z.infer<typeof changePlanStatusSchema>;
export type ListPlansQuery = z.infer<typeof listPlansQuerySchema>;
export type CreateFeatureInput = z.infer<typeof createFeatureSchema>;
export type UpdateFeatureInput = z.infer<typeof updateFeatureSchema>;
export type ChangeFeatureStatusInput = z.infer<typeof changeFeatureStatusSchema>;
export type ListFeaturesQuery = z.infer<typeof listFeaturesQuerySchema>;
export type UpdatePlanFeatureInput = z.infer<typeof updatePlanFeatureSchema>;
export type AttachPlanFeatureInput = z.infer<typeof attachPlanFeatureSchema>;
