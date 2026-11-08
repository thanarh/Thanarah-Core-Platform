import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { TrustedTenantContext } from '../tenant/tenant-context.contract';
import {
  CommunicationProviderUnavailableError,
  CommunicationRetentionPolicyInvalidError,
  CommunicationRetentionPolicyRequiredError,
  CommunicationSyntheticInputRequiredError,
  CommunicationWebhookRejectedError,
} from './communications.errors';
import type {
  SaveCommunicationConsentInput,
  SaveCommunicationPolicyInput,
  SimulateCommunicationInput,
} from './communications.dto';
import { normalizedCommunicationWebhookEventsSchema } from './communications.dto';
import type {
  CommunicationChannel,
  CommunicationConsent,
  CommunicationEvent,
  CommunicationEventView,
  CommunicationProviderStatus,
  CommunicationRetentionPolicy,
  CommunicationStorage,
  CommunicationWebhookAdapter,
  NormalizedCommunicationWebhookEvent,
} from './communications.types';
import { COMMUNICATIONS_STORAGE, COMMUNICATIONS_WEBHOOK_ADAPTER } from './communications.types';

const PROVIDER_STATUSES: readonly CommunicationProviderStatus[] = [
  { channel: 'WHATSAPP', configured: false, liveEnabled: false, status: 'UNCONFIGURED' },
  { channel: 'VOICE', configured: false, liveEnabled: false, status: 'UNCONFIGURED' },
];

@Injectable()
export class CommunicationsService {
  constructor(
    @Inject(COMMUNICATIONS_STORAGE) private readonly store: CommunicationStorage,
    @Inject(COMMUNICATIONS_WEBHOOK_ADAPTER)
    private readonly webhookAdapter: CommunicationWebhookAdapter,
  ) {}

  listProviders(): readonly CommunicationProviderStatus[] {
    return PROVIDER_STATUSES;
  }

  async verifyWebhookChallenge(input: {
    provider: string;
    tenantIdCandidate: string;
    query: Record<string, string | string[] | undefined>;
    headers: Record<string, string | string[] | undefined>;
  }): Promise<string> {
    const verified = await this.webhookAdapter.verifyChallenge(input);
    if (verified.context.tenantId !== input.tenantIdCandidate) {
      throw new CommunicationWebhookRejectedError();
    }
    if (
      typeof verified.challenge !== 'string' ||
      verified.challenge.length < 1 ||
      verified.challenge.length > 2048 ||
      /[\u0000-\u001f\u007f]/u.test(verified.challenge)
    ) {
      throw new CommunicationWebhookRejectedError();
    }
    return verified.challenge;
  }

  getPolicy(context: TrustedTenantContext): Promise<CommunicationRetentionPolicy> {
    return this.store.getPolicy(context);
  }

  async savePolicy(
    context: TrustedTenantContext,
    input: SaveCommunicationPolicyInput,
    actorUserId: string,
  ): Promise<CommunicationRetentionPolicy> {
    if (input.retentionDays !== null) {
      const expiry = Date.now() + input.retentionDays * 24 * 60 * 60 * 1000;
      if (!Number.isFinite(expiry) || !Number.isFinite(new Date(expiry).getTime())) {
        throw new CommunicationRetentionPolicyInvalidError();
      }
    }
    return this.store.savePolicy(context, input, actorUserId);
  }

  getConsent(
    context: TrustedTenantContext,
    subjectRef: string,
    channel: CommunicationChannel,
  ): Promise<CommunicationConsent | null> {
    return this.store.getConsent(context, subjectRef, channel);
  }

  async saveConsent(
    context: TrustedTenantContext,
    input: SaveCommunicationConsentInput,
    actorUserId: string,
  ): Promise<CommunicationConsent> {
    const consent = await this.store.saveConsent(context, {
      subjectRef: input.subjectRef,
      channel: input.channel,
      status: input.status,
      language: input.language ?? null,
      source: input.source,
      evidenceRef: input.status === 'OPTED_IN' ? (input.evidenceRef ?? null) : null,
      updatedBy: actorUserId,
      updatedAt: new Date().toISOString(),
    });

    const policy = await this.store.getPolicy(context);
    if (policy.retentionDays) {
      await this.store.recordEvent(
        context,
        this.createEvent({
          idempotencyKey: `consent:${randomUUID()}`,
          type: 'CONSENT_CHANGED',
          channel: input.channel,
          status: input.status,
          template: null,
          providerEventId: null,
          actorUserId,
          attemptCount: 0,
          retentionDays: policy.retentionDays,
        }),
      );
    }
    return consent;
  }

  async simulate(
    context: TrustedTenantContext,
    input: SimulateCommunicationInput,
    actorUserId: string,
  ): Promise<{ status: CommunicationEvent['status']; liveSent: false; recorded: boolean }> {
    if (!input.subjectRef.startsWith('synthetic:')) {
      throw new CommunicationSyntheticInputRequiredError();
    }
    const [consent, policy] = await Promise.all([
      this.store.getConsent(context, input.subjectRef, input.channel),
      this.store.getPolicy(context),
    ]);
    const status: CommunicationEvent['status'] =
      consent?.status !== 'OPTED_IN'
        ? 'BLOCKED_CONSENT'
        : !policy.retentionDays
          ? 'BLOCKED_RETENTION_POLICY'
          : 'SIMULATED';

    if (!policy.retentionDays) return { status, liveSent: false, recorded: false };
    await this.store.recordEvent(
      context,
      this.createEvent({
        idempotencyKey: `simulation:${randomUUID()}`,
        type: status === 'SIMULATED' ? 'SIMULATION' : 'AUTOMATION_BLOCKED',
        channel: input.channel,
        status,
        template: input.template,
        providerEventId: null,
        actorUserId,
        attemptCount: 0,
        retentionDays: policy.retentionDays,
      }),
    );
    return { status, liveSent: false, recorded: true };
  }

  async listEvents(context: TrustedTenantContext, limit = 50): Promise<CommunicationEventView[]> {
    const events = await this.store.listEvents(context, Math.max(1, Math.min(limit, 100)));
    return events.map(
      ({
        idempotencyKey: _key,
        providerEventId: _providerId,
        correlationRef: _correlationRef,
        ...event
      }) => event,
    );
  }

  async ingestWebhook(input: {
    provider: string;
    tenantIdCandidate: string;
    rawBody: Buffer;
    headers: Record<string, string | string[] | undefined>;
  }): Promise<{ accepted: number; duplicates: number }> {
    if (!Buffer.isBuffer(input.rawBody)) {
      throw new CommunicationWebhookRejectedError();
    }
    const verified = await this.webhookAdapter.authenticateAndParse(input);
    if (verified.context.tenantId !== input.tenantIdCandidate) {
      throw new CommunicationWebhookRejectedError();
    }
    const events = normalizedCommunicationWebhookEventsSchema.safeParse(verified.events);
    if (!events.success) throw new CommunicationWebhookRejectedError();

    let accepted = 0;
    let duplicates = 0;
    for (const event of events.data) {
      const result = await this.processVerifiedWebhook(verified.context, input.provider, event);
      if (result) accepted += 1;
      else duplicates += 1;
    }
    return { accepted, duplicates };
  }

  private async processVerifiedWebhook(
    context: TrustedTenantContext,
    provider: string,
    event: NormalizedCommunicationWebhookEvent,
  ): Promise<boolean> {
    const policy = await this.store.getPolicy(context);
    if (!policy.retentionDays) throw new CommunicationRetentionPolicyRequiredError();

    if (event.status === 'OPTED_OUT' && event.optOutSubjectRef) {
      await this.store.saveConsent(context, {
        subjectRef: event.optOutSubjectRef,
        channel: event.channel,
        status: 'OPTED_OUT',
        language: null,
        source: 'INBOUND_STOP',
        evidenceRef: null,
        updatedBy: 'provider-webhook',
        updatedAt: event.occurredAt,
      });
    }

    const type = event.status.startsWith('HANDOFF_')
      ? 'HANDOFF_STATUS'
      : event.channel === 'VOICE'
        ? 'CALL_STATUS'
        : 'DELIVERY_STATUS';
    const result = await this.store.recordEvent(
      context,
      this.createEvent({
        idempotencyKey: `webhook:${provider}:${event.providerEventId}`,
        type,
        channel: event.channel,
        status: event.status,
        template: null,
        providerEventId: event.providerEventId,
        correlationRef: event.correlationRef ?? null,
        actorUserId: 'provider-webhook',
        attemptCount: 0,
        retentionDays: policy.retentionDays,
        occurredAt: event.occurredAt,
      }),
    );
    return result.created;
  }

  private createEvent(input: {
    idempotencyKey: string;
    type: CommunicationEvent['type'];
    channel: CommunicationChannel;
    status: CommunicationEvent['status'];
    template: CommunicationEvent['template'];
    providerEventId: string | null;
    correlationRef?: string | null;
    actorUserId: string;
    attemptCount: number;
    retentionDays: number;
    occurredAt?: string;
  }): CommunicationEvent {
    const occurredAt = input.occurredAt ?? new Date().toISOString();
    const recordedAt = new Date().toISOString();
    const expiresAtTime =
      new Date(recordedAt).getTime() + input.retentionDays * 24 * 60 * 60 * 1000;
    if (!Number.isFinite(expiresAtTime) || !Number.isFinite(new Date(expiresAtTime).getTime())) {
      throw new CommunicationRetentionPolicyInvalidError();
    }
    return {
      id: randomUUID(),
      idempotencyKey: input.idempotencyKey,
      type: input.type,
      channel: input.channel,
      status: input.status,
      template: input.template,
      providerEventId: input.providerEventId,
      correlationRef: input.correlationRef ?? null,
      actorUserId: input.actorUserId,
      attemptCount: input.attemptCount,
      occurredAt,
      recordedAt,
      expiresAt: new Date(expiresAtTime).toISOString(),
    };
  }
}

@Injectable()
export class UnconfiguredCommunicationWebhookAdapter implements CommunicationWebhookAdapter {
  async verifyChallenge(): Promise<never> {
    throw new CommunicationProviderUnavailableError();
  }

  async authenticateAndParse(): Promise<never> {
    throw new CommunicationProviderUnavailableError();
  }
}
