import { z } from 'zod';
import { clinicWebsiteSlugSchema } from './clinic-website.model';

export const clinicWebsiteExpectedVersionSchema = z.number().int().nonnegative();
export const clinicWebsiteSlugParamSchema = clinicWebsiteSlugSchema;
export const clinicWebsiteVersionParamSchema = z.coerce.number().int().positive();

export const saveClinicWebsiteDraftSchema = z
  .object({
    expectedVersion: clinicWebsiteExpectedVersionSchema,
    draft: z.unknown(),
  })
  .strict();

export const clinicWebsiteVersionBodySchema = z
  .object({ expectedVersion: clinicWebsiteExpectedVersionSchema })
  .strict();

export type SaveClinicWebsiteDraftInput = z.infer<typeof saveClinicWebsiteDraftSchema>;
export type ClinicWebsiteVersionInput = z.infer<typeof clinicWebsiteVersionBodySchema>;
