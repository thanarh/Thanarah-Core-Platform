import { TenantMembershipStatus } from '@prisma/client';
import { z } from 'zod';

export const tenantMembershipIdSchema = z.string().uuid();

export const createTenantMembershipSchema = z
  .object({
    platformUserId: z.string().uuid(),
  })
  .strict();

export const listTenantMembershipsQuerySchema = z
  .object({
    status: z.nativeEnum(TenantMembershipStatus).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
  })
  .strict();

export type CreateTenantMembershipInput = z.infer<typeof createTenantMembershipSchema>;
export type ListTenantMembershipsQuery = z.infer<typeof listTenantMembershipsQuerySchema>;
