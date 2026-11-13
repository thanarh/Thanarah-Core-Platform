import { Inject, Injectable } from '@nestjs/common';
import type { Collection, Document } from 'mongodb';
import {
  TenantContextInvalidError,
  isWellFormedTrustedTenantContext,
} from '../tenant/tenant-context.contract';
import type { TrustedTenantContext } from '../tenant/tenant-context.contract';
import {
  TenantStorageNotConfiguredError,
  TenantStorageUnavailableError,
} from '../tenant/tenant-storage.errors';
import type { TenantStorageResolver } from '../tenant/tenant-storage.contract';
import { TENANT_STORAGE_RESOLVER } from '../tenant/tenant-storage.resolver';
import { TenantMongoClientManager } from '../tenant/tenant-mongo-client.manager';
import {
  TENANT_STORAGE_TARGET_RESOLVER,
  type TenantStorageTargetRecord,
  type TenantStorageTargetResolver,
} from '../tenant/tenant-storage.registry.contract';
import type {
  CommunicationConsent,
  CommunicationEvent,
  CommunicationRetentionPolicy,
  CommunicationStorage,
} from './communications.types';

interface ScopedDocument extends Document {
  _id: string;
  _tenantId: string;
}

interface PolicyDocument extends ScopedDocument {
  retentionDays: number | null;
  maxRetryAttempts: number;
  updatedBy: string | null;
  updatedAt: string | null;
}

interface ConsentDocument extends ScopedDocument, Omit<CommunicationConsent, 'subjectRef'> {
  subjectRef: string;
}

interface EventDocument extends ScopedDocument, Omit<CommunicationEvent, 'id'> {
  expiresAtDate: Date;
}

const POLICIES = 'communications_policies';
const CONSENTS = 'communications_consents';
const EVENTS = 'communications_events';

@Injectable()
export class MongoCommunicationsStorage implements CommunicationStorage {
  constructor(
    @Inject(TENANT_STORAGE_RESOLVER) private readonly routes: TenantStorageResolver,
    @Inject(TENANT_STORAGE_TARGET_RESOLVER)
    private readonly targets: TenantStorageTargetResolver,
    private readonly clients: TenantMongoClientManager,
  ) {}

  async getPolicy(context: TrustedTenantContext): Promise<CommunicationRetentionPolicy> {
    const document = await (
      await this.collection<PolicyDocument>(context, POLICIES)
    ).findOne({ _tenantId: context.tenantId, _id: 'tenant' });
    return document ? policyFromDocument(document) : defaultPolicy();
  }

  async savePolicy(
    context: TrustedTenantContext,
    input: Pick<CommunicationRetentionPolicy, 'retentionDays' | 'maxRetryAttempts'>,
    actorUserId: string,
  ): Promise<CommunicationRetentionPolicy> {
    const value: PolicyDocument = {
      _id: 'tenant',
      _tenantId: context.tenantId,
      ...input,
      updatedBy: actorUserId,
      updatedAt: new Date().toISOString(),
    };
    await (
      await this.collection<PolicyDocument>(context, POLICIES)
    ).replaceOne({ _tenantId: context.tenantId, _id: 'tenant' }, value, { upsert: true });
    return policyFromDocument(value);
  }

  async getConsent(
    context: TrustedTenantContext,
    subjectRef: string,
    channel: CommunicationConsent['channel'],
  ): Promise<CommunicationConsent | null> {
    const document = await (
      await this.collection<ConsentDocument>(context, CONSENTS)
    ).findOne({ _tenantId: context.tenantId, subjectRef, channel });
    return document ? consentFromDocument(document) : null;
  }

  async saveConsent(
    context: TrustedTenantContext,
    consent: CommunicationConsent,
  ): Promise<CommunicationConsent> {
    const collection = await this.collection<ConsentDocument>(context, CONSENTS);
    const document: ConsentDocument = {
      _id: `${consent.channel}:${consent.subjectRef}`,
      _tenantId: context.tenantId,
      subjectRef: consent.subjectRef,
      channel: consent.channel,
      status: consent.status,
      language: consent.language,
      source: consent.source,
      evidenceRef: consent.evidenceRef,
      updatedBy: consent.updatedBy,
      updatedAt: consent.updatedAt,
    };
    const { _id, ...fields } = document;
    try {
      await collection.updateOne(
        {
          _tenantId: context.tenantId,
          subjectRef: consent.subjectRef,
          channel: consent.channel,
          updatedAt: { $lte: consent.updatedAt },
        },
        { $set: fields, $setOnInsert: { _id } },
        { upsert: true },
      );
      return consentFromDocument(document);
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      const current = await collection.findOne({
        _tenantId: context.tenantId,
        subjectRef: consent.subjectRef,
        channel: consent.channel,
      });
      if (!current) throw new TenantStorageUnavailableError();
      return consentFromDocument(current);
    }
  }

  async recordEvent(
    context: TrustedTenantContext,
    event: CommunicationEvent,
  ): Promise<{ created: boolean; event: CommunicationEvent }> {
    const collection = await this.collection<EventDocument>(context, EVENTS);
    const document: EventDocument = {
      _id: event.id,
      _tenantId: context.tenantId,
      idempotencyKey: event.idempotencyKey,
      type: event.type,
      channel: event.channel,
      status: event.status,
      template: event.template,
      providerEventId: event.providerEventId,
      correlationRef: event.correlationRef,
      actorUserId: event.actorUserId,
      attemptCount: event.attemptCount,
      occurredAt: event.occurredAt,
      recordedAt: event.recordedAt,
      expiresAt: event.expiresAt,
      expiresAtDate: new Date(event.expiresAt),
    };
    try {
      await collection.insertOne(document);
      return { created: true, event: eventFromDocument(document) };
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      const existing = await collection.findOne({
        _tenantId: context.tenantId,
        idempotencyKey: event.idempotencyKey,
      });
      if (!existing) throw new TenantStorageUnavailableError();
      return { created: false, event: eventFromDocument(existing) };
    }
  }

  async listEvents(context: TrustedTenantContext, limit: number): Promise<CommunicationEvent[]> {
    const now = new Date();
    const documents = await (
      await this.collection<EventDocument>(context, EVENTS)
    )
      .find({ _tenantId: context.tenantId, expiresAtDate: { $gt: now } })
      .sort({ occurredAt: -1, _id: -1 })
      .limit(limit)
      .toArray();
    return documents.map(eventFromDocument);
  }

  private async collection<T extends ScopedDocument>(
    context: TrustedTenantContext,
    name: string,
  ): Promise<Collection<T>> {
    if (!context || !isWellFormedTrustedTenantContext(context)) {
      throw new TenantContextInvalidError();
    }

    try {
      const route = await this.routes.resolve(context);
      if (route.placements.length !== 1) throw new TenantStorageUnavailableError();
      const placement = route.placements[0];
      if (!placement) throw new TenantStorageNotConfiguredError();
      const target = await this.targets.findActivePrimaryTarget(context, placement.placementId);
      assertTargetMatchesTenant(target, context.tenantId);
      const collection = (await this.clients.getDatabase(target)).collection<T>(name);
      await ensureIndexes(collection, name);
      return collection;
    } catch (error) {
      if (
        error instanceof TenantContextInvalidError ||
        error instanceof TenantStorageNotConfiguredError ||
        error instanceof TenantStorageUnavailableError
      ) {
        throw error;
      }
      throw new TenantStorageUnavailableError();
    }
  }
}

@Injectable()
export class InMemoryCommunicationsStorage implements CommunicationStorage {
  private readonly policies = new Map<string, CommunicationRetentionPolicy>();
  private readonly consents = new Map<string, Map<string, CommunicationConsent>>();
  private readonly events = new Map<string, Map<string, CommunicationEvent>>();

  async getPolicy(context: TrustedTenantContext): Promise<CommunicationRetentionPolicy> {
    return { ...(this.policies.get(this.tenant(context)) ?? defaultPolicy()) };
  }

  async savePolicy(
    context: TrustedTenantContext,
    input: Pick<CommunicationRetentionPolicy, 'retentionDays' | 'maxRetryAttempts'>,
    actorUserId: string,
  ): Promise<CommunicationRetentionPolicy> {
    const value: CommunicationRetentionPolicy = {
      ...input,
      updatedBy: actorUserId,
      updatedAt: new Date().toISOString(),
    };
    this.policies.set(this.tenant(context), value);
    return { ...value };
  }

  async getConsent(
    context: TrustedTenantContext,
    subjectRef: string,
    channel: CommunicationConsent['channel'],
  ): Promise<CommunicationConsent | null> {
    const value = this.consents.get(this.tenant(context))?.get(`${channel}:${subjectRef}`);
    return value ? { ...value } : null;
  }

  async saveConsent(
    context: TrustedTenantContext,
    consent: CommunicationConsent,
  ): Promise<CommunicationConsent> {
    const items = getOrCreate(this.consents, this.tenant(context));
    const key = `${consent.channel}:${consent.subjectRef}`;
    const current = items.get(key);
    if (current && new Date(current.updatedAt).getTime() > new Date(consent.updatedAt).getTime()) {
      return { ...current };
    }
    items.set(key, { ...consent });
    return { ...consent };
  }

  async recordEvent(
    context: TrustedTenantContext,
    event: CommunicationEvent,
  ): Promise<{ created: boolean; event: CommunicationEvent }> {
    const items = getOrCreate(this.events, this.tenant(context));
    const existing = [...items.values()].find(
      (item) => item.idempotencyKey === event.idempotencyKey,
    );
    if (existing) return { created: false, event: { ...existing } };
    items.set(event.id, { ...event });
    return { created: true, event: { ...event } };
  }

  async listEvents(context: TrustedTenantContext, limit: number): Promise<CommunicationEvent[]> {
    const now = Date.now();
    return [...(this.events.get(this.tenant(context))?.values() ?? [])]
      .filter((event) => new Date(event.expiresAt).getTime() > now)
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
      .slice(0, limit)
      .map((event) => ({ ...event }));
  }

  private tenant(context: TrustedTenantContext): string {
    if (!context || !isWellFormedTrustedTenantContext(context)) {
      throw new TenantContextInvalidError();
    }
    return context.tenantId;
  }
}

@Injectable()
export class UnconfiguredCommunicationsStorage implements CommunicationStorage {
  private unavailable(): never {
    throw new TenantStorageNotConfiguredError();
  }

  getPolicy(): Promise<CommunicationRetentionPolicy> {
    return Promise.reject(this.unavailable());
  }

  savePolicy(): Promise<CommunicationRetentionPolicy> {
    return Promise.reject(this.unavailable());
  }

  getConsent(): Promise<CommunicationConsent | null> {
    return Promise.reject(this.unavailable());
  }

  saveConsent(): Promise<CommunicationConsent> {
    return Promise.reject(this.unavailable());
  }

  recordEvent(): Promise<{ created: boolean; event: CommunicationEvent }> {
    return Promise.reject(this.unavailable());
  }

  listEvents(): Promise<CommunicationEvent[]> {
    return Promise.reject(this.unavailable());
  }
}

function defaultPolicy(): CommunicationRetentionPolicy {
  return {
    retentionDays: null,
    maxRetryAttempts: 0,
    updatedBy: null,
    updatedAt: null,
  };
}

function policyFromDocument(document: PolicyDocument): CommunicationRetentionPolicy {
  return {
    retentionDays: document.retentionDays,
    maxRetryAttempts: document.maxRetryAttempts,
    updatedBy: document.updatedBy,
    updatedAt: document.updatedAt,
  };
}

function consentFromDocument(document: ConsentDocument): CommunicationConsent {
  return {
    subjectRef: document.subjectRef,
    channel: document.channel,
    status: document.status,
    language: document.language,
    source: document.source,
    evidenceRef: document.evidenceRef,
    updatedBy: document.updatedBy,
    updatedAt: document.updatedAt,
  };
}

function eventFromDocument(document: EventDocument): CommunicationEvent {
  return {
    id: document._id,
    idempotencyKey: document.idempotencyKey,
    type: document.type,
    channel: document.channel,
    status: document.status,
    template: document.template,
    providerEventId: document.providerEventId,
    correlationRef: document.correlationRef,
    actorUserId: document.actorUserId,
    attemptCount: document.attemptCount,
    occurredAt: document.occurredAt,
    recordedAt: document.recordedAt,
    expiresAt: document.expiresAt,
  };
}

function assertTargetMatchesTenant(
  target: TenantStorageTargetRecord | null,
  tenantId: string,
): asserts target is TenantStorageTargetRecord {
  if (
    !target ||
    target.tenantId !== tenantId ||
    target.status !== 'ACTIVE' ||
    target.isPrimary !== true
  ) {
    throw new TenantStorageNotConfiguredError();
  }
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 11000
  );
}

function getOrCreate<T>(store: Map<string, Map<string, T>>, tenantId: string): Map<string, T> {
  let values = store.get(tenantId);
  if (!values) {
    values = new Map<string, T>();
    store.set(tenantId, values);
  }
  return values;
}

async function ensureIndexes<T extends ScopedDocument>(
  collection: Collection<T>,
  name: string,
): Promise<void> {
  await collection.createIndex(
    { _tenantId: 1, _id: 1 },
    { name: `${name}_tenant_id_unique`, unique: true },
  );
  if (name === POLICIES) {
    await collection.createIndex(
      { _tenantId: 1 },
      { name: 'communications_policy_tenant_unique', unique: true },
    );
  } else if (name === CONSENTS) {
    await collection.createIndex(
      { _tenantId: 1, subjectRef: 1, channel: 1 },
      { name: 'communications_consent_subject_channel_unique', unique: true },
    );
  } else if (name === EVENTS) {
    await collection.createIndex(
      { _tenantId: 1, idempotencyKey: 1 },
      { name: 'communications_event_idempotency_unique', unique: true },
    );
    await collection.createIndex(
      { expiresAtDate: 1 },
      { name: 'communications_event_expiry_ttl', expireAfterSeconds: 0 },
    );
  }
}
