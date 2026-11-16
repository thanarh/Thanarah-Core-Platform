import { z } from 'zod';

export const startPatientPortalClaimSchema = z
  .object({
    operationId: z.string().uuid(),
    consentAccepted: z.literal(true),
  })
  .strict();

export const verifyPatientPortalClaimSchema = z
  .object({
    challengeId: z.string().uuid(),
    code: z.string().regex(/^\d{6}$/u),
  })
  .strict();

export type StartPatientPortalClaimInput = z.infer<typeof startPatientPortalClaimSchema>;
export type VerifyPatientPortalClaimInput = z.infer<typeof verifyPatientPortalClaimSchema>;
