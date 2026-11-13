import { TenantCatalogStatus } from '../common/domain-enums';
import { z } from 'zod';

export type HealthcareCatalogKind = 'department' | 'specialty';

export function normalizeHealthcareCatalogName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
}

const healthcareCatalogNameSchema = z
  .string()
  .transform(normalizeHealthcareCatalogName)
  .pipe(z.string().min(1).max(191));

const healthcareCatalogDescriptionSchema = z
  .string()
  .max(512)
  .nullable()
  .transform((value) => (typeof value === 'string' ? value.trim() || null : value))
  .optional();

export const createHealthcareCatalogSchema = z
  .object({
    name: healthcareCatalogNameSchema,
    description: healthcareCatalogDescriptionSchema,
  })
  .strict();

export const updateHealthcareCatalogSchema = z
  .object({
    name: healthcareCatalogNameSchema.optional(),
    description: healthcareCatalogDescriptionSchema,
  })
  .strict()
  .refine(({ name, description }) => name !== undefined || description !== undefined);

export const listHealthcareCatalogQuerySchema = z
  .object({
    status: z.nativeEnum(TenantCatalogStatus).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
  })
  .strict();

export const healthcareCatalogIdSchema = z
  .string()
  .uuid()
  .transform((id) => id.toLowerCase());

export type CreateHealthcareCatalogInput = z.infer<typeof createHealthcareCatalogSchema>;
export type UpdateHealthcareCatalogInput = z.infer<typeof updateHealthcareCatalogSchema>;
export type ListHealthcareCatalogQuery = z.infer<typeof listHealthcareCatalogQuerySchema>;
