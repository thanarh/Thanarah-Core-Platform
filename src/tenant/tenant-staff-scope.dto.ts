import { z } from 'zod';

export const createTenantStaffFacilityAssignmentSchema = z
  .object({
    facilityId: z
      .string()
      .uuid()
      .transform((id) => id.toLowerCase()),
  })
  .strict();

export const createTenantStaffBranchAssignmentSchema = z
  .object({
    branchId: z
      .string()
      .uuid()
      .transform((id) => id.toLowerCase()),
  })
  .strict();

export const tenantStaffScopeFacilityIdSchema = z
  .string()
  .uuid()
  .transform((id) => id.toLowerCase());

export const tenantStaffScopeBranchIdSchema = z
  .string()
  .uuid()
  .transform((id) => id.toLowerCase());

export type CreateTenantStaffFacilityAssignmentInput = z.infer<
  typeof createTenantStaffFacilityAssignmentSchema
>;
export type CreateTenantStaffBranchAssignmentInput = z.infer<
  typeof createTenantStaffBranchAssignmentSchema
>;
