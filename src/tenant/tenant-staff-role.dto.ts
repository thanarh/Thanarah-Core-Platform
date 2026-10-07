import { z } from 'zod';

export const createTenantStaffRoleAssignmentSchema = z
  .object({
    roleId: z.string().uuid(),
  })
  .strict();

export type CreateTenantStaffRoleAssignmentInput = z.infer<
  typeof createTenantStaffRoleAssignmentSchema
>;
