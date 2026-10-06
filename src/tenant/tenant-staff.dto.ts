import { StaffStatus } from '@prisma/client';
import { z } from 'zod';

const staffDisplayNameSchema = z
  .string()
  .transform((value) => value.normalize('NFKC').trim().replace(/\s+/gu, ' '))
  .pipe(z.string().min(1).max(191));

const staffJobTitleSchema = z
  .string()
  .transform((value) => value.normalize('NFKC').trim().replace(/\s+/gu, ' '))
  .pipe(z.string().min(1).max(191));

export const createTenantStaffSchema = z
  .object({
    membershipId: z
      .string()
      .uuid()
      .transform((id) => id.toLowerCase()),
    displayName: staffDisplayNameSchema.optional(),
    jobTitle: staffJobTitleSchema.optional(),
  })
  .strict();

export const updateTenantStaffSchema = z
  .object({
    displayName: staffDisplayNameSchema.optional(),
    jobTitle: staffJobTitleSchema.nullable().optional(),
  })
  .strict()
  .refine(({ displayName, jobTitle }) => displayName !== undefined || jobTitle !== undefined);

export const listTenantStaffQuerySchema = z
  .object({
    status: z.nativeEnum(StaffStatus).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
  })
  .strict();

export const tenantStaffIdSchema = z
  .string()
  .uuid()
  .transform((id) => id.toLowerCase());

export type CreateTenantStaffInput = z.infer<typeof createTenantStaffSchema>;
export type UpdateTenantStaffInput = z.infer<typeof updateTenantStaffSchema>;
export type ListTenantStaffQuery = z.infer<typeof listTenantStaffQuerySchema>;
