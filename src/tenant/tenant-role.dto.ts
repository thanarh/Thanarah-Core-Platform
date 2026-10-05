import { z } from 'zod';
import { TENANT_PERMISSION_CODES } from './tenant-authorization.constants';

export const tenantRoleIdSchema = z.string().uuid();

const roleCodeSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/));

export const createTenantRoleSchema = z
  .object({
    code: roleCodeSchema,
    name: z.string().trim().min(2).max(128),
    description: z.string().trim().max(512).nullable().optional(),
  })
  .strict();

export type CreateTenantRoleInput = z.infer<typeof createTenantRoleSchema>;

export const updateTenantRoleSchema = z
  .object({
    name: z.string().trim().min(2).max(128).optional(),
    description: z.string().trim().max(512).nullable().optional(),
  })
  .strict()
  .refine((value) => value.name !== undefined || value.description !== undefined);

export type UpdateTenantRoleInput = z.infer<typeof updateTenantRoleSchema>;

export const replaceTenantRolePermissionsSchema = z
  .object({
    permissionCodes: z
      .array(z.enum(TENANT_PERMISSION_CODES))
      .max(TENANT_PERMISSION_CODES.length)
      .refine((codes) => new Set(codes).size === codes.length),
  })
  .strict();

export type ReplaceTenantRolePermissionsInput = z.infer<typeof replaceTenantRolePermissionsSchema>;

export const bootstrapTenantOwnerSchema = z
  .object({
    platformUserId: z.string().uuid(),
  })
  .strict();

export type BootstrapTenantOwnerInput = z.infer<typeof bootstrapTenantOwnerSchema>;
