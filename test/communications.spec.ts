import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type {
  CommunicationWebhookAdapter,
  NormalizedCommunicationWebhookEvent,
} from '../src/communications/communications.types';
import {
  CommunicationProviderUnavailableError,
  CommunicationRetentionPolicyRequiredError,
  CommunicationRetentionPolicyInvalidError,
  CommunicationSyntheticInputRequiredError,
  CommunicationWebhookRejectedError,
} from '../src/communications/communications.errors';
import { CommunicationsController } from '../src/communications/communications.controller';
import { CommunicationsService } from '../src/communications/communications.service';
import {
  InMemoryCommunicationsStorage,
  MongoCommunicationsStorage,
} from '../src/communications/communications.storage';
import { UnconfiguredCommunicationWebhookAdapter } from '../src/communications/communications.service';
import { verifyHmacSha256WebhookSignature } from '../src/communications/webhook-signature';
import { TrustedTenantContextFactoryService } from '../src/tenant/tenant-context.service';
import type { TrustedTenantContext } from '../src/tenant/tenant-context.contract';
import { TENANT_REQUIRED_PERMISSIONS } from '../src/tenant/tenant-require-permissions.decorator';
import {
  DEFAULT_TENANT_ROLES,
  TENANT_PERMISSION_CODES,
} from '../src/tenant/tenant-authorization.constants';
import { TenantStorageNotConfiguredError } from '../src/tenant/tenant-storage.errors';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const PATIENT_A = '33333333-3333-4333-8333-333333333333';
const USER_A = '44444444-4444-4444-8444-444444444444';
const SECRET = 'synthetic-webhook-secret';

interface SignedInput {
  provider: string;
  tenantIdCandidate: string;
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
}

function trustedContext(tenantId: string): TrustedTenantContext {
  return new TrustedTenantContextFactoryService().fromValidatedMembership({
    tenantId: tenantId as never,
    membershipId: '55555555-5555-4555-8555-555555555555' as never,
    platformUserId: USER_A,
  } as never);
}

function makeWebhookAdapter(
  events: unknown[] = [],
  expectedTenantId?: string,
): CommunicationWebhookAdapter {
  return {
    async verifyChallenge({
      tenantIdCandidate,
    }: {
      tenantIdCandidate: string;
    }): Promise<{ context: TrustedTenantContext; challenge: string }> {
      return {
        context: trustedContext(tenantIdCandidate),
        challenge: 'synthetic-challenge',
      };
    },
    async authenticateAndParse(
      input: Parameters<CommunicationWebhookAdapter['authenticateAndParse']>[0],
    ): Promise<Awaited<ReturnType<CommunicationWebhookAdapter['authenticateAndParse']>>> {
      if (
        !verifyHmacSha256WebhookSignature(
          input.rawBody,
          typeof input.headers['x-hub-signature-256'] === 'string'
            ? input.headers['x-hub-signature-256']
            : undefined,
          SECRET,
        )
      ) {
        throw new CommunicationWebhookRejectedError();
      }
      const tenantId = expectedTenantId ?? input.tenantIdCandidate;
      return {
        context: trustedContext(tenantId),
        events: events as never,
      };
    },
  };
}

function signedInput(
  tenantIdCandidate = TENANT_A,
  rawBody = Buffer.from('synthetic payload'),
): SignedInput {
  const signature = createHmac('sha256', SECRET).update(rawBody).digest('hex');
  return {
    provider: 'whatsapp',
    tenantIdCandidate,
    rawBody,
    headers: { 'x-hub-signature-256': `sha256=${signature}` },
  };
}

function event(
  overrides: Partial<NormalizedCommunicationWebhookEvent> = {},
): NormalizedCommunicationWebhookEvent {
  return {
    providerEventId: 'evt.synthetic-01',
    channel: 'WHATSAPP',
    status: 'DELIVERED',
    occurredAt: '2026-11-09T12:00:00.000Z',
    ...overrides,
  };
}

describe('Thanarah tenant communications foundation', () => {
  it('defines separate owner/admin permissions and controller requirements', () => {
    const required = [
      'tenant.communications.read',
      'tenant.communications.manage',
      'tenant.communications.consent.manage',
      'tenant.communications.simulate',
    ] as const;
    for (const code of required) expect(TENANT_PERMISSION_CODES).toContain(code);

    const owner = DEFAULT_TENANT_ROLES.find(({ code }) => code === 'OWNER');
    const admin = DEFAULT_TENANT_ROLES.find(({ code }) => code === 'ADMIN');
    const member = DEFAULT_TENANT_ROLES.find(({ code }) => code === 'MEMBER');
    for (const code of required) {
      expect(owner?.permissionCodes).toContain(code);
      expect(admin?.permissionCodes).toContain(code);
      expect(member?.permissionCodes).not.toContain(code);
    }

    expect(
      Reflect.getMetadata(
        TENANT_REQUIRED_PERMISSIONS,
        CommunicationsController.prototype.listProviders,
      ),
    ).toEqual(['tenant.communications.read']);
    expect(
      Reflect.getMetadata(
        TENANT_REQUIRED_PERMISSIONS,
        CommunicationsController.prototype.savePolicy,
      ),
    ).toEqual(['tenant.communications.manage']);
    expect(
      Reflect.getMetadata(
        TENANT_REQUIRED_PERMISSIONS,
        CommunicationsController.prototype.saveConsent,
      ),
    ).toEqual(['tenant.communications.consent.manage']);
    expect(
      Reflect.getMetadata(TENANT_REQUIRED_PERMISSIONS, CommunicationsController.prototype.simulate),
    ).toEqual(['tenant.communications.simulate']);

    const migration = readFileSync(
      'prisma/migrations/20261109160000_safe_communications_foundation/migration.sql',
      'utf8',
    );
    for (const code of required) expect(migration).toContain(code);
  });

  it('verifies HMAC over exact raw bytes and rejects missing or altered signatures', () => {
    const rawBody = Buffer.from('synthetic webhook bytes');
    const signature = createHmac('sha256', SECRET).update(rawBody).digest('hex');
    expect(verifyHmacSha256WebhookSignature(rawBody, `sha256=${signature}`, SECRET)).toBe(true);
    expect(
      verifyHmacSha256WebhookSignature(Buffer.from('changed bytes'), `sha256=${signature}`, SECRET),
    ).toBe(false);
    expect(verifyHmacSha256WebhookSignature(rawBody, undefined, SECRET)).toBe(false);
    expect(verifyHmacSha256WebhookSignature(rawBody, `sha256=${signature}`, '')).toBe(false);
  });

  it('keeps consent and events tenant-scoped and applies opt-out to one channel only', async () => {
    const store = new InMemoryCommunicationsStorage();
    const contextA = trustedContext(TENANT_A);
    const contextB = trustedContext(TENANT_B);
    await store.saveConsent(contextA, {
      subjectRef: PATIENT_A,
      channel: 'WHATSAPP',
      status: 'OPTED_OUT',
      language: 'ar',
      source: 'STAFF_RECORDED',
      evidenceRef: null,
      updatedBy: USER_A,
      updatedAt: '2026-11-09T12:00:00.000Z',
    });

    expect(await store.getConsent(contextA, PATIENT_A, 'WHATSAPP')).toMatchObject({
      status: 'OPTED_OUT',
    });
    expect(await store.getConsent(contextB, PATIENT_A, 'WHATSAPP')).toBeNull();
    expect(await store.getConsent(contextA, PATIENT_A, 'VOICE')).toBeNull();
  });

  it('records a synthetic simulation only when tenant consent and retention are configured', async () => {
    const store = new InMemoryCommunicationsStorage();
    const context = trustedContext(TENANT_A);
    const service = new CommunicationsService(store, makeWebhookAdapter());
    const simulation = {
      subjectRef: 'synthetic:demo',
      channel: 'WHATSAPP' as const,
      template: 'APPOINTMENT_REMINDER' as const,
    };

    await expect(service.simulate(context, simulation, USER_A)).resolves.toEqual({
      status: 'BLOCKED_CONSENT',
      liveSent: false,
      recorded: false,
    });
    await store.saveConsent(context, {
      subjectRef: simulation.subjectRef,
      channel: simulation.channel,
      status: 'OPTED_IN',
      language: 'en',
      source: 'PATIENT_DIRECT',
      evidenceRef: 'synthetic-evidence',
      updatedBy: USER_A,
      updatedAt: new Date().toISOString(),
    });
    await expect(service.simulate(context, simulation, USER_A)).resolves.toMatchObject({
      status: 'BLOCKED_RETENTION_POLICY',
      liveSent: false,
      recorded: false,
    });
    await store.savePolicy(context, { retentionDays: 30, maxRetryAttempts: 2 }, USER_A);
    await expect(service.simulate(context, simulation, USER_A)).resolves.toEqual({
      status: 'SIMULATED',
      liveSent: false,
      recorded: true,
    });
    await expect(service.listEvents(context)).resolves.toHaveLength(1);
    await expect(
      service.simulate(context, { ...simulation, subjectRef: PATIENT_A }, USER_A),
    ).rejects.toBeInstanceOf(CommunicationSyntheticInputRequiredError);
  });

  it('keeps all real provider channels disabled and rejects unconfigured webhooks', async () => {
    const service = new CommunicationsService(
      new InMemoryCommunicationsStorage(),
      new UnconfiguredCommunicationWebhookAdapter(),
    );
    expect(service.listProviders()).toEqual([
      { channel: 'WHATSAPP', configured: false, liveEnabled: false, status: 'UNCONFIGURED' },
      { channel: 'VOICE', configured: false, liveEnabled: false, status: 'UNCONFIGURED' },
    ]);
    await expect(
      service.verifyWebhookChallenge({
        provider: 'whatsapp',
        tenantIdCandidate: TENANT_A,
        query: {},
        headers: {},
      }),
    ).rejects.toBeInstanceOf(CommunicationProviderUnavailableError);
    await expect(service.ingestWebhook(signedInput())).rejects.toBeInstanceOf(
      CommunicationProviderUnavailableError,
    );
  });

  it('rejects unrepresentable retention periods rather than creating invalid expiry dates', async () => {
    const service = new CommunicationsService(
      new InMemoryCommunicationsStorage(),
      makeWebhookAdapter(),
    );
    await expect(
      service.savePolicy(
        trustedContext(TENANT_A),
        { retentionDays: Number.MAX_SAFE_INTEGER, maxRetryAttempts: 0 },
        USER_A,
      ),
    ).rejects.toBeInstanceOf(CommunicationRetentionPolicyInvalidError);
  });

  it('rejects consent opt-in without an evidence reference at the DTO boundary', async () => {
    const { saveCommunicationConsentSchema } =
      await import('../src/communications/communications.dto');
    expect(
      saveCommunicationConsentSchema.safeParse({
        subjectRef: PATIENT_A,
        channel: 'WHATSAPP',
        status: 'OPTED_IN',
        source: 'STAFF_RECORDED',
      }).success,
    ).toBe(false);
    expect(
      saveCommunicationConsentSchema.safeParse({
        subjectRef: PATIENT_A,
        channel: 'WHATSAPP',
        status: 'OPTED_OUT',
        source: 'STAFF_RECORDED',
      }).success,
    ).toBe(true);
  });

  it('authenticates webhook bytes, deduplicates events, and hides provider identifiers', async () => {
    const store = new InMemoryCommunicationsStorage();
    const context = trustedContext(TENANT_A);
    await store.savePolicy(context, { retentionDays: 30, maxRetryAttempts: 1 }, USER_A);
    const adapter = makeWebhookAdapter([event()]);
    const service = new CommunicationsService(store, adapter);

    await expect(service.ingestWebhook(signedInput())).resolves.toEqual({
      accepted: 1,
      duplicates: 0,
    });
    await expect(service.ingestWebhook(signedInput())).resolves.toEqual({
      accepted: 0,
      duplicates: 1,
    });
    const events = await service.listEvents(context);
    expect(events).toHaveLength(1);
    expect(events[0]).not.toHaveProperty('idempotencyKey');
    expect(events[0]).not.toHaveProperty('providerEventId');

    const tampered = signedInput();
    tampered.rawBody = Buffer.from('tampered synthetic payload');
    await expect(service.ingestWebhook(tampered)).rejects.toBeInstanceOf(
      CommunicationWebhookRejectedError,
    );
  });

  it('rejects an adapter result that crosses the requested tenant boundary', async () => {
    const store = new InMemoryCommunicationsStorage();
    const service = new CommunicationsService(store, makeWebhookAdapter([event()], TENANT_B));
    await expect(service.ingestWebhook(signedInput(TENANT_A))).rejects.toBeInstanceOf(
      CommunicationWebhookRejectedError,
    );
  });

  it('applies a verified opt-out and prevents stale duplicate events from restoring older consent', async () => {
    const store = new InMemoryCommunicationsStorage();
    const context = trustedContext(TENANT_A);
    const eventTime = '2026-11-09T11:00:00.000Z';
    await store.savePolicy(context, { retentionDays: 30, maxRetryAttempts: 0 }, USER_A);
    await store.saveConsent(context, {
      subjectRef: PATIENT_A,
      channel: 'WHATSAPP',
      status: 'OPTED_IN',
      language: 'ar',
      source: 'PATIENT_DIRECT',
      evidenceRef: 'synthetic-consent-proof',
      updatedBy: USER_A,
      updatedAt: '2026-11-09T12:00:00.000Z',
    });
    const service = new CommunicationsService(
      store,
      makeWebhookAdapter([
        event({
          status: 'OPTED_OUT',
          occurredAt: eventTime,
          optOutSubjectRef: PATIENT_A,
        }),
      ]),
    );
    await service.ingestWebhook(signedInput());
    expect(await store.getConsent(context, PATIENT_A, 'WHATSAPP')).toMatchObject({
      status: 'OPTED_IN',
    });
  });

  it('does not accept provider events without a configured retention policy', async () => {
    const service = new CommunicationsService(
      new InMemoryCommunicationsStorage(),
      makeWebhookAdapter([event()]),
    );
    await expect(service.ingestWebhook(signedInput())).rejects.toBeInstanceOf(
      CommunicationRetentionPolicyRequiredError,
    );
  });

  it('tracks normalized human-handoff status without exposing its correlation reference', async () => {
    const store = new InMemoryCommunicationsStorage();
    const context = trustedContext(TENANT_A);
    await store.savePolicy(context, { retentionDays: 30, maxRetryAttempts: 0 }, USER_A);
    const service = new CommunicationsService(
      store,
      makeWebhookAdapter([
        event({
          status: 'HANDOFF_REQUESTED',
          correlationRef: 'synthetic-thread-01',
        }),
      ]),
    );

    await expect(service.ingestWebhook(signedInput())).resolves.toMatchObject({
      accepted: 1,
      duplicates: 0,
    });
    const [handoff] = await service.listEvents(context);
    expect(handoff).toMatchObject({
      type: 'HANDOFF_STATUS',
      status: 'HANDOFF_REQUESTED',
    });
    expect(handoff).not.toHaveProperty('correlationRef');
  });

  it('queries Mongo collections only after validating tenant and active primary placement', async () => {
    const context = trustedContext(TENANT_A);
    const placementId = '66666666-6666-4666-8666-666666666666';
    const collection = {
      createIndex: vi.fn().mockResolvedValue('index'),
      findOne: vi.fn().mockResolvedValue(null),
    };
    const database = { collection: vi.fn(() => collection) };
    const routeResolver = {
      resolve: vi.fn().mockResolvedValue({ placements: [{ placementId }] }),
    };
    const targetResolver = {
      findActivePrimaryTarget: vi.fn().mockResolvedValue({
        id: placementId,
        tenantId: TENANT_A,
        provider: 'MONGODB',
        connectionReference: 'synthetic',
        databaseName: 'synthetic_tenant',
        status: 'ACTIVE',
        isPrimary: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    };
    const clients = { getDatabase: vi.fn().mockResolvedValue(database) };
    const storage = new MongoCommunicationsStorage(
      routeResolver as never,
      targetResolver as never,
      clients as never,
    );

    await expect(storage.getPolicy(context)).resolves.toMatchObject({
      retentionDays: null,
      maxRetryAttempts: 0,
    });
    expect(routeResolver.resolve).toHaveBeenCalledWith(context);
    expect(targetResolver.findActivePrimaryTarget).toHaveBeenCalledWith(context, placementId);
    expect(collection.findOne).toHaveBeenCalledWith({
      _tenantId: TENANT_A,
      _id: 'tenant',
    });

    targetResolver.findActivePrimaryTarget.mockResolvedValue({
      id: placementId,
      tenantId: TENANT_B,
      provider: 'MONGODB',
      connectionReference: 'synthetic',
      databaseName: 'synthetic_tenant',
      status: 'ACTIVE',
      isPrimary: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await expect(storage.getPolicy(context)).rejects.toBeInstanceOf(
      TenantStorageNotConfiguredError,
    );
  });

  it('stores Mongo expiry as a BSON date and creates the TTL index', async () => {
    const context = trustedContext(TENANT_A);
    const placementId = '66666666-6666-4666-8666-666666666666';
    const collection = {
      createIndex: vi.fn().mockResolvedValue('index'),
      insertOne: vi.fn().mockResolvedValue({ acknowledged: true }),
    };
    const database = { collection: vi.fn(() => collection) };
    const routeResolver = {
      resolve: vi.fn().mockResolvedValue({ placements: [{ placementId }] }),
    };
    const targetResolver = {
      findActivePrimaryTarget: vi.fn().mockResolvedValue({
        id: placementId,
        tenantId: TENANT_A,
        provider: 'MONGODB',
        connectionReference: 'synthetic',
        databaseName: 'synthetic_tenant',
        status: 'ACTIVE',
        isPrimary: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    };
    const storage = new MongoCommunicationsStorage(
      routeResolver as never,
      targetResolver as never,
      { getDatabase: vi.fn().mockResolvedValue(database) } as never,
    );
    const eventTime = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();

    await storage.recordEvent(context, {
      id: '77777777-7777-4777-8777-777777777777',
      idempotencyKey: 'synthetic:event-once',
      type: 'SIMULATION',
      channel: 'WHATSAPP',
      status: 'SIMULATED',
      template: 'APPOINTMENT_REMINDER',
      providerEventId: null,
      correlationRef: null,
      actorUserId: USER_A,
      attemptCount: 0,
      occurredAt: eventTime,
      recordedAt: eventTime,
      expiresAt,
    });

    expect(collection.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ expiresAtDate: new Date(expiresAt) }),
    );
    expect(collection.createIndex).toHaveBeenCalledWith(
      { expiresAtDate: 1 },
      { name: 'communications_event_expiry_ttl', expireAfterSeconds: 0 },
    );
  });
});
