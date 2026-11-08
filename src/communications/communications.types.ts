import type { TrustedTenantContext } from '../tenant/tenant-context.contract';

export const COMMUNICATIONS_STORAGE = Symbol('COMMUNICATIONS_STORAGE');
export const COMMUNICATIONS_WEBHOOK_ADAPTER = Symbol('COMMUNICATIONS_WEBHOOK_ADAPTER');

export const COMMUNICATION_CHANNELS = ['WHATSAPP', 'VOICE'] as const;
export type CommunicationChannel = (typeof COMMUNICATION_CHANNELS)[number];

export const COMMUNICATION_TEMPLATES = ['APPOINTMENT_REMINDER', 'HUMAN_HANDOFF_NOTICE'] as const;
export type CommunicationTemplate = (typeof COMMUNICATION_TEMPLATES)[number];

export type ConsentStatus = 'OPTED_IN' | 'OPTED_OUT';
export type ConsentSource = 'PATIENT_DIRECT' | 'STAFF_RECORDED' | 'INBOUND_STOP';
export type CommunicationLanguage = 'ar' | 'en';

export interface CommunicationConsent {
  subjectRef: string;
  channel: CommunicationChannel;
  status: ConsentStatus;
  language: CommunicationLanguage | null;
  source: ConsentSource;
  evidenceRef: string | null;
  updatedBy: string;
  updatedAt: string;
}

export interface CommunicationRetentionPolicy {
  retentionDays: number | null;
  maxRetryAttempts: number;
  updatedBy: string | null;
  updatedAt: string | null;
}

export type CommunicationEventType =
  | 'SIMULATION'
  | 'DELIVERY_STATUS'
  | 'CALL_STATUS'
  | 'HANDOFF_STATUS'
  | 'AUTOMATION_BLOCKED'
  | 'CONSENT_CHANGED';

export type CommunicationEventStatus =
  | 'SIMULATED'
  | 'BLOCKED_CONSENT'
  | 'BLOCKED_RETENTION_POLICY'
  | 'SENT'
  | 'DELIVERED'
  | 'READ'
  | 'FAILED'
  | 'RETRY_PENDING'
  | 'RINGING'
  | 'ANSWERED'
  | 'COMPLETED'
  | 'NO_ANSWER'
  | 'HANDOFF_REQUESTED'
  | 'HANDOFF_ACCEPTED'
  | 'HANDOFF_COMPLETED'
  | 'HANDOFF_CANCELLED'
  | 'OPTED_IN'
  | 'OPTED_OUT';

export interface CommunicationEvent {
  id: string;
  idempotencyKey: string;
  type: CommunicationEventType;
  channel: CommunicationChannel;
  status: CommunicationEventStatus;
  template: CommunicationTemplate | null;
  providerEventId: string | null;
  correlationRef: string | null;
  actorUserId: string;
  attemptCount: number;
  occurredAt: string;
  recordedAt: string;
  expiresAt: string;
}

export type CommunicationEventView = Omit<
  CommunicationEvent,
  'idempotencyKey' | 'providerEventId' | 'correlationRef'
>;

export interface NormalizedCommunicationWebhookEvent {
  providerEventId: string;
  channel: CommunicationChannel;
  status: CommunicationEventStatus;
  occurredAt: string;
  optOutSubjectRef?: string;
  correlationRef?: string;
}

export interface CommunicationProviderStatus {
  channel: CommunicationChannel;
  configured: boolean;
  liveEnabled: boolean;
  status: 'DISABLED' | 'UNCONFIGURED';
}

export interface CommunicationStorage {
  getPolicy(context: TrustedTenantContext): Promise<CommunicationRetentionPolicy>;
  savePolicy(
    context: TrustedTenantContext,
    input: Pick<CommunicationRetentionPolicy, 'retentionDays' | 'maxRetryAttempts'>,
    actorUserId: string,
  ): Promise<CommunicationRetentionPolicy>;
  getConsent(
    context: TrustedTenantContext,
    subjectRef: string,
    channel: CommunicationChannel,
  ): Promise<CommunicationConsent | null>;
  saveConsent(
    context: TrustedTenantContext,
    consent: CommunicationConsent,
  ): Promise<CommunicationConsent>;
  recordEvent(
    context: TrustedTenantContext,
    event: CommunicationEvent,
  ): Promise<{ created: boolean; event: CommunicationEvent }>;
  listEvents(context: TrustedTenantContext, limit: number): Promise<CommunicationEvent[]>;
}

export interface CommunicationWebhookAdapter {
  /**
   * Adapters authenticate raw provider data and resolve the candidate tenant
   * through server-side provider configuration before returning trusted scope.
   * The candidate tenant id is never proof of membership or provider ownership.
   */
  verifyChallenge(input: {
    provider: string;
    tenantIdCandidate: string;
    query: Record<string, string | string[] | undefined>;
    headers: Record<string, string | string[] | undefined>;
  }): Promise<{ context: TrustedTenantContext; challenge: string }>;
  authenticateAndParse(input: {
    provider: string;
    tenantIdCandidate: string;
    rawBody: Buffer;
    headers: Record<string, string | string[] | undefined>;
  }): Promise<{
    context: TrustedTenantContext;
    events: readonly NormalizedCommunicationWebhookEvent[];
  }>;
}
