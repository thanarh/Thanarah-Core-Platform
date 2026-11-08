import { z } from 'zod';
import { COMMUNICATION_CHANNELS, COMMUNICATION_TEMPLATES } from './communications.types';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const subjectReferencePattern = /^synthetic:[a-z0-9][a-z0-9._:-]{0,63}$/iu;
const evidenceReferencePattern = /^[a-z0-9][a-z0-9._:/-]{0,127}$/iu;

export const communicationChannelSchema = z.enum(COMMUNICATION_CHANNELS);
export const communicationProviderSchema = z.enum(['whatsapp', 'voice']);
export const consentSubjectRefSchema = z.string().regex(uuidPattern);

export const saveCommunicationPolicySchema = z.object({
  retentionDays: z.number().int().safe().positive().nullable(),
  maxRetryAttempts: z.number().int().safe().nonnegative(),
});

export type SaveCommunicationPolicyInput = z.infer<typeof saveCommunicationPolicySchema>;

export const saveCommunicationConsentSchema = z
  .object({
    subjectRef: consentSubjectRefSchema,
    channel: communicationChannelSchema,
    status: z.enum(['OPTED_IN', 'OPTED_OUT']),
    source: z.enum(['PATIENT_DIRECT', 'STAFF_RECORDED']),
    evidenceRef: z.string().regex(evidenceReferencePattern).optional().nullable(),
    language: z.enum(['ar', 'en']).optional().nullable(),
  })
  .refine((value) => value.status !== 'OPTED_IN' || Boolean(value.evidenceRef?.trim()), {
    message: 'An evidence reference is required to record opt-in consent',
  });

export type SaveCommunicationConsentInput = z.infer<typeof saveCommunicationConsentSchema>;

export const simulateCommunicationSchema = z.object({
  subjectRef: z.string().regex(subjectReferencePattern),
  channel: communicationChannelSchema,
  template: z.enum(COMMUNICATION_TEMPLATES),
});

export type SimulateCommunicationInput = z.infer<typeof simulateCommunicationSchema>;

export const communicationEventQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const communicationWebhookParamsSchema = z.object({
  provider: communicationProviderSchema,
  tenantId: z.string().regex(uuidPattern),
});

export const normalizedCommunicationWebhookEventSchema = z
  .object({
    providerEventId: z.string().regex(/^[a-z0-9._:-]{1,191}$/iu),
    channel: communicationChannelSchema,
    status: z.enum([
      'SENT',
      'DELIVERED',
      'READ',
      'FAILED',
      'RETRY_PENDING',
      'RINGING',
      'ANSWERED',
      'COMPLETED',
      'NO_ANSWER',
      'HANDOFF_REQUESTED',
      'HANDOFF_ACCEPTED',
      'HANDOFF_COMPLETED',
      'HANDOFF_CANCELLED',
      'OPTED_OUT',
    ]),
    occurredAt: z.string().datetime(),
    optOutSubjectRef: consentSubjectRefSchema.optional(),
    correlationRef: z
      .string()
      .regex(/^[a-z0-9._:-]{1,191}$/iu)
      .optional(),
  })
  .refine((event) => event.status !== 'OPTED_OUT' || Boolean(event.optOutSubjectRef), {
    message: 'Opt-out events require a tenant patient reference',
  })
  .refine((event) => !event.status.startsWith('HANDOFF_') || Boolean(event.correlationRef), {
    message: 'Handoff status events require a correlation reference',
  });

export const normalizedCommunicationWebhookEventsSchema = z
  .array(normalizedCommunicationWebhookEventSchema)
  .max(100);
