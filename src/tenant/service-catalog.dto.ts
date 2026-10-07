import { TenantCatalogStatus } from '@prisma/client';
import { z } from 'zod';

const serviceNameSchema = z
  .string()
  .transform((value) => value.normalize('NFKC').trim().replace(/\s+/gu, ' '))
  .pipe(z.string().min(1).max(191));

const serviceCodeSchema = z
  .string()
  .transform((value) => value.normalize('NFKC').trim().replace(/\s+/gu, ' '))
  .pipe(z.string().min(1).max(64));

const serviceDescriptionSchema = z
  .string()
  .transform((value) => value.normalize('NFKC').replace(/\r\n?/gu, '\n').trim())
  .pipe(z.string().min(1).max(2000))
  .refine((value) => !/<\/?[a-z][^>]*>/iu.test(value), {
    message: 'Description must contain plain text, not HTML markup',
  });

export const createServiceSchema = z
  .object({
    name: serviceNameSchema,
    code: serviceCodeSchema.optional(),
    description: serviceDescriptionSchema.nullable().optional(),
  })
  .strict();

export const updateServiceSchema = z
  .object({
    name: serviceNameSchema.optional(),
    code: serviceCodeSchema.nullable().optional(),
    description: serviceDescriptionSchema.nullable().optional(),
  })
  .strict()
  .refine((service) => Object.values(service).some((value) => value !== undefined));

export const listServicesQuerySchema = z
  .object({
    status: z.nativeEnum(TenantCatalogStatus).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
  })
  .strict();

export const serviceIdSchema = z
  .string()
  .uuid()
  .transform((id) => id.toLowerCase());

export type CreateServiceInput = z.infer<typeof createServiceSchema>;
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;
export type ListServicesQuery = z.infer<typeof listServicesQuerySchema>;
