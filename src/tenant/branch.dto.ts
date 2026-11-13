import { BranchStatus } from '../common/domain-enums';
import { z } from 'zod';
import { normalizeFacilityName } from './facility.dto';

const branchNameSchema = z
  .string()
  .transform(normalizeFacilityName)
  .pipe(z.string().min(1).max(191));

export const createBranchSchema = z
  .object({
    name: branchNameSchema,
  })
  .strict();

export const updateBranchSchema = z
  .object({
    name: branchNameSchema.optional(),
  })
  .strict()
  .refine(({ name }) => name !== undefined);

export const listBranchesQuerySchema = z
  .object({
    status: z.nativeEnum(BranchStatus).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
  })
  .strict();

export const branchFacilityIdSchema = z
  .string()
  .uuid()
  .transform((facilityId) => facilityId.toLowerCase());

export const branchIdSchema = z
  .string()
  .uuid()
  .transform((branchId) => branchId.toLowerCase());

export type CreateBranchInput = z.infer<typeof createBranchSchema>;
export type UpdateBranchInput = z.infer<typeof updateBranchSchema>;
export type ListBranchesQuery = z.infer<typeof listBranchesQuerySchema>;
