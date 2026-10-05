import { FacilityStatus } from '@prisma/client';
import { z } from 'zod';

export function normalizeFacilityName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
}

const facilityNameSchema = z
  .string()
  .transform(normalizeFacilityName)
  .pipe(z.string().min(1).max(191));

export const createFacilitySchema = z
  .object({
    name: facilityNameSchema,
  })
  .strict();

export const updateFacilitySchema = z
  .object({
    name: facilityNameSchema.optional(),
  })
  .strict()
  .refine(({ name }) => name !== undefined);

export const listFacilitiesQuerySchema = z
  .object({
    status: z.nativeEnum(FacilityStatus).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
  })
  .strict();

export const facilityIdSchema = z
  .string()
  .uuid()
  .transform((facilityId) => facilityId.toLowerCase());

export type CreateFacilityInput = z.infer<typeof createFacilitySchema>;
export type UpdateFacilityInput = z.infer<typeof updateFacilitySchema>;
export type ListFacilitiesQuery = z.infer<typeof listFacilitiesQuerySchema>;
