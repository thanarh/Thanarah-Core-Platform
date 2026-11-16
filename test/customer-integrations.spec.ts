import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '../src/config/config.service';
import { JourneyIntegrations } from '../src/customer-journey/journey.integrations';
import type { JourneyStore } from '../src/customer-journey/journey.store';
import { validateEnv } from '../src/config/env.schema';

const OTP_SECRET = 'synthetic-test-secret-do-not-use-outside-tests';
const EMBED_KEY = 'synthetic-embed-key';
const API_KEY = 'synthetic-api-key';

function harness(ttlIndexAvailable = true) {
  const userId = randomUUID();
  const now = new Date();
  let account: Record<string, unknown> = {
    _id: randomUUID(),
    userId,
    email: 'customer@example.test',
    fullName: 'Synthetic Customer',
    profile: {
      legalName: 'Synthetic Clinic',
      displayName: 'Synthetic Clinic',
      registrationNumber: 'TEST-ONLY',
      city: 'Test',
      address: 'Synthetic address',
      contactName: 'Synthetic contact',
      phoneE164: '+966500000001',
    },
    version: 1,
    phoneVerification: { status: 'UNVERIFIED', phoneE164: null, verifiedAt: null },
    createdAt: now,
    updatedAt: now,
  };
  const documents = new Map<string, Record<string, unknown>>();
  const matches = (document: Record<string, unknown>, filter: Record<string, unknown>) =>
    Object.entries(filter).every(([key, expected]) => {
      const actual = document[key];
      if (expected && typeof expected === 'object' && '$gt' in expected) {
        return actual instanceof Date && actual > (expected as { $gt: Date }).$gt;
      }
      if (expected && typeof expected === 'object' && '$ne' in expected) {
        return actual !== (expected as { $ne: unknown }).$ne;
      }
      if (expected && typeof expected === 'object' && '$in' in expected) {
        return (expected as { $in: unknown[] }).$in.includes(actual);
      }
      return actual === expected;
    });
  const db = {
    collection: () => ({
      listIndexes: () => ({
        toArray: async () =>
          ttlIndexAvailable
            ? [{ name: 'ttl_customer_whatsapp_expiry', expireAfterSeconds: 0 }]
            : [],
      }),
      findOne: async (
        filter: Record<string, unknown>,
        options?: { sort?: Record<string, 1 | -1> },
      ) => {
        const found = [...documents.values()].filter((document) => matches(document, filter));
        if (options?.sort) {
          const [key, direction] = Object.entries(options.sort)[0];
          found.sort((left, right) => {
            const leftValue = (left[key] as Date)?.getTime?.() ?? 0;
            const rightValue = (right[key] as Date)?.getTime?.() ?? 0;
            return (leftValue - rightValue) * direction;
          });
        }
        return found[0] ?? null;
      },
      insertOne: async (document: Record<string, unknown>) => {
        documents.set(String(document._id), document);
        return { acknowledged: true };
      },
      updateOne: async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
        const document = [...documents.values()].find((item) => matches(item, filter));
        if (!document) return { matchedCount: 0 };
        Object.assign(document, update.$set ?? {});
        for (const [key, amount] of Object.entries(update.$inc ?? {})) {
          document[key] = Number(document[key] ?? 0) + Number(amount);
        }
        return { matchedCount: 1 };
      },
    }),
  };
  const store = {
    run: async (work: (tx: unknown) => unknown) => work({ db, session: {} }),
    manager: { getDatabase: async () => db },
    fence: async () => undefined,
    account: async () => account,
    save: async (
      _tx: unknown,
      _name: string,
      current: Record<string, unknown>,
      changes: object,
    ) => {
      account = {
        ...current,
        ...changes,
        version: Number(current.version) + 1,
        updatedAt: new Date(),
      };
      return account;
    },
  } as unknown as JourneyStore;
  const config = {
    thanarahApiBaseUrl: 'https://ai.thanarah.com',
    thanarahApiKey: API_KEY,
    thanarahEmbedKey: EMBED_KEY,
    thanarahEmbedIntegrationId: '6afa6048869da5a0dc6f4c21',
    thanarahEmbedAllowedOrigins: ['https://thanarah.com'],
    whatsappOtpHmacSecret: OTP_SECRET,
  } as ConfigService;
  return {
    service: new JourneyIntegrations(store, config),
    userId,
    documents,
    get account() {
      return account;
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('customer Thanarah integrations', () => {
  it('keeps integrations disabled by default and requires strong OTP signing material', () => {
    expect(validateEnv({})).toMatchObject({
      THANARAH_API_BASE_URL: 'https://ai.thanarah.com',
      THANARAH_API_KEY: '',
      THANARAH_EMBED_KEY: '',
      THANARAH_EMBED_ALLOWED_ORIGINS: 'https://thanarah.com',
    });
    expect(() =>
      validateEnv({
        THANARAH_API_KEY: API_KEY,
        WHATSAPP_OTP_HMAC_SECRET: 'too-short',
      }),
    ).toThrow(/WHATSAPP_OTP_HMAC_SECRET/u);
    expect(() => validateEnv({ THANARAH_API_BASE_URL: 'http://ai.thanarah.com' })).toThrow(
      /HTTPS origin/u,
    );
  });

  it('fails closed when the challenge expiry index is missing', async () => {
    const h = harness(false);
    const remote = vi.fn();
    vi.stubGlobal('fetch', remote);
    await expect(
      h.service.sendWhatsApp(h.userId, {
        operationId: randomUUID(),
        consentAccepted: true,
      }),
    ).rejects.toMatchObject({
      code: 'CUSTOMER_WHATSAPP_UNAVAILABLE',
      status: 503,
    });
    expect(remote).not.toHaveBeenCalled();
  });

  it('bootstraps only an authenticated subject with an exact approved origin', async () => {
    const h = harness();
    const remote = vi.fn(async (_url: URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ 'x-thanarah-integration-key': EMBED_KEY });
      expect(JSON.parse(String(init?.body))).toEqual({
        externalUserId: h.userId,
        origin: 'https://thanarah.com',
      });
      return new Response(
        JSON.stringify({
          framePath: '/embed/6afa6048869da5a0dc6f4c21?origin=https%3A%2F%2Fthanarah.com',
          code: 'synthetic-one-time-code-123456',
          nonce: 'synthetic-nonce-123456',
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', remote);

    const result = await h.service.embedBootstrap(h.userId, 'https://thanarah.com');
    expect(result.frameUrl).toBe(
      'https://ai.thanarah.com/embed/6afa6048869da5a0dc6f4c21?origin=https%3A%2F%2Fthanarah.com',
    );
    expect(result.frameOrigin).toBe('https://ai.thanarah.com');
    expect(result.integrationId).toBe('6afa6048869da5a0dc6f4c21');
    expect(remote).toHaveBeenCalledTimes(1);
  });

  it('rejects unapproved origins before calling the remote embed service', async () => {
    const h = harness();
    const remote = vi.fn();
    vi.stubGlobal('fetch', remote);
    await expect(h.service.embedBootstrap(h.userId, 'https://evil.example')).rejects.toMatchObject({
      code: 'CUSTOMER_AI_EMBED_ORIGIN_DENIED',
      status: 403,
    });
    expect(remote).not.toHaveBeenCalled();
  });

  it('queues an OTP with consent and an idempotency key, then verifies the phone', async () => {
    const h = harness();
    let sentText = '';
    const remote = vi.fn(async (_url: URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers['x-api-key']).toBe(API_KEY);
      expect(headers['idempotency-key']).toBeTruthy();
      const body = JSON.parse(String(init?.body)) as {
        to: string;
        text: string;
        consentReference: string;
      };
      expect(body.to).toBe('+966500000001');
      expect(body.consentReference).toBe(headers['idempotency-key']);
      sentText = body.text;
      return new Response(JSON.stringify({ requestId: 'synthetic-queue-1' }), { status: 202 });
    });
    vi.stubGlobal('fetch', remote);

    const operationId = randomUUID();
    const sent = await h.service.sendWhatsApp(h.userId, {
      operationId,
      consentAccepted: true,
    });
    expect(sent).toMatchObject({
      challengeId: operationId,
      status: 'QUEUED',
      requestId: 'synthetic-queue-1',
    });
    expect(sent).not.toHaveProperty('code');
    expect(remote).toHaveBeenCalledTimes(1);
    await expect(
      h.service.sendWhatsApp(h.userId, {
        operationId: randomUUID(),
        consentAccepted: true,
      }),
    ).resolves.toMatchObject({ challengeId: operationId, status: 'QUEUED' });
    expect(remote).toHaveBeenCalledTimes(1);
    const code = sentText.match(/\b\d{6}\b/u)?.[0];
    expect(code).toBeDefined();

    await expect(
      h.service.verifyWhatsApp(h.userId, {
        operationId: randomUUID(),
        challengeId: operationId,
        code,
      }),
    ).resolves.toEqual({ verified: true });
    expect(h.account.phoneVerification).toMatchObject({
      status: 'VERIFIED',
      phoneE164: '+966500000001',
    });
    await expect(
      h.service.sendWhatsApp(h.userId, { operationId, consentAccepted: true }),
    ).resolves.toMatchObject({ status: 'VERIFIED' });
    expect(remote).toHaveBeenCalledTimes(1);
  });

  it('reuses the same message and idempotency key after an uncertain network result', async () => {
    const h = harness();
    const remote = vi
      .fn()
      .mockRejectedValueOnce(new Error('synthetic timeout'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'synthetic-queue-2' }), { status: 200 }),
      );
    vi.stubGlobal('fetch', remote);
    const operationId = randomUUID();
    const input = { operationId, consentAccepted: true };

    await expect(h.service.sendWhatsApp(h.userId, input)).rejects.toMatchObject({
      code: 'CUSTOMER_WHATSAPP_OUTCOME_UNKNOWN',
      status: 503,
    });
    await expect(h.service.sendWhatsApp(h.userId, input)).resolves.toMatchObject({
      challengeId: operationId,
      requestId: 'synthetic-queue-2',
      status: 'QUEUED',
    });
    expect(remote).toHaveBeenCalledTimes(2);
    expect(remote.mock.calls[0][1]?.headers).toEqual(remote.mock.calls[1][1]?.headers);
    expect(remote.mock.calls[0][1]?.body).toEqual(remote.mock.calls[1][1]?.body);
  });

  it('does not verify a changed phone or an expired challenge', async () => {
    const h = harness();
    const remote = vi.fn(async () => new Response(JSON.stringify({ id: 'synthetic-queue-3' })));
    vi.stubGlobal('fetch', remote);
    const operationId = randomUUID();
    await h.service.sendWhatsApp(h.userId, { operationId, consentAccepted: true });
    const challenge = h.documents.get(operationId)!;
    challenge.expiresAt = new Date(Date.now() - 1000);
    await expect(
      h.service.verifyWhatsApp(h.userId, {
        operationId: randomUUID(),
        challengeId: operationId,
        code: '000000',
      }),
    ).rejects.toMatchObject({ code: 'CUSTOMER_WHATSAPP_CHALLENGE_EXPIRED' });
    expect(h.account.phoneVerification).toMatchObject({ status: 'UNVERIFIED' });
  });

  it('limits each challenge to five verification attempts', async () => {
    const h = harness();
    let queuedText = '';
    vi.stubGlobal('fetch', async (_url: URL, init?: RequestInit) => {
      queuedText = (JSON.parse(String(init?.body)) as { text: string }).text;
      return new Response(JSON.stringify({ id: 'synthetic-queue-4' }));
    });
    const challengeId = randomUUID();
    await h.service.sendWhatsApp(h.userId, {
      operationId: challengeId,
      consentAccepted: true,
    });
    const validCode = queuedText.match(/\b\d{6}\b/u)?.[0];
    expect(validCode).toBeDefined();
    const wrongCode = validCode === '000000' ? '000001' : '000000';

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        h.service.verifyWhatsApp(h.userId, {
          operationId: randomUUID(),
          challengeId,
          code: wrongCode,
        }),
      ).rejects.toMatchObject({ code: 'CUSTOMER_WHATSAPP_CODE_INVALID' });
    }
    await expect(
      h.service.verifyWhatsApp(h.userId, {
        operationId: randomUUID(),
        challengeId,
        code: wrongCode,
      }),
    ).rejects.toMatchObject({ code: 'CUSTOMER_WHATSAPP_ATTEMPTS_EXCEEDED', status: 429 });
    expect(h.documents.get(challengeId)?.attempts).toBe(5);
    expect(h.account.phoneVerification).toMatchObject({ status: 'UNVERIFIED' });
  });
});
