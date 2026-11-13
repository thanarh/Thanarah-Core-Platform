import { TenantStatus } from '../common/domain-enums';
import { z } from 'zod';

export function normalizeTenantSlug(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function normalizeTenantName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
}

const tenantSlugSchema = z
  .string()
  .transform(normalizeTenantSlug)
  .pipe(
    z
      .string()
      .min(3)
      .max(64)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  );

const tenantNameSchema = z.string().transform(normalizeTenantName).pipe(z.string().min(1).max(191));

export const createTenantSchema = z
  .object({
    slug: tenantSlugSchema,
    legalName: tenantNameSchema,
    displayName: tenantNameSchema.optional(),
  })
  .strict();

export const changeTenantStatusSchema = z
  .object({
    status: z.nativeEnum(TenantStatus),
  })
  .strict();

export const listTenantsQuerySchema = z
  .object({
    status: z.nativeEnum(TenantStatus).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
  })
  .strict();

export const tenantIdSchema = z.string().uuid();

export type CreateTenantInput = z.infer<typeof createTenantSchema>;
export type ChangeTenantStatusInput = z.infer<typeof changeTenantStatusSchema>;
export type ListTenantsQuery = z.infer<typeof listTenantsQuerySchema>;
