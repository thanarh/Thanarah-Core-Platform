import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ConfigService } from '../config/config.service';
import { fail } from '../internal-operations/operations.errors';
import { collection, parse, JourneyStore } from './journey.store';

const id = z.string().uuid();
const sendWhatsAppSchema = z
  .object({
    operationId: id,
    consentAccepted: z.literal(true),
  })
  .strict();
const verifyWhatsAppSchema = z
  .object({
    operationId: id,
    challengeId: id,
    code: z.string().regex(/^\d{6}$/u),
  })
  .strict();
const challengeSchema = z
  .object({
    _id: id,
    userId: id,
    accountId: id,
    phoneE164: z.string().regex(/^\+[1-9]\d{7,14}$/u),
    codeDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    consentReference: id,
    consentAcceptedAt: z.date(),
    consentTextVersion: z.literal(1),
    status: z.enum(['SENDING', 'QUEUED', 'VERIFIED', 'EXPIRED']),
    queueRequestId: z.string().max(191).nullable(),
    attempts: z.number().int().min(0).max(5),
    createdAt: z.date(),
    updatedAt: z.date(),
    expiresAt: z.date(),
  })
  .strict();
type Challenge = z.infer<typeof challengeSchema>;

@Injectable()
export class JourneyIntegrations {
  constructor(
    private readonly store: JourneyStore,
    private readonly config: ConfigService,
  ) {}

  async embedBootstrap(userId: string, requestedOrigin: string | undefined) {
    const origin = exactOrigin(requestedOrigin);
    if (!origin || !this.config.thanarahEmbedAllowedOrigins.includes(origin)) {
      fail('CUSTOMER_AI_EMBED_ORIGIN_DENIED', 'مصدر تضمين المساعد غير معتمد.', 403);
    }
    if (!this.config.thanarahEmbedKey.trim()) {
      fail('CUSTOMER_AI_EMBED_UNAVAILABLE', 'تضمين المساعد غير مهيأ حاليًا.', 503);
    }

    const endpoint = new URL(
      `/api/embedded/${encodeURIComponent(this.config.thanarahEmbedIntegrationId)}/bootstrap`,
      this.config.thanarahApiBaseUrl,
    );
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-thanarah-integration-key': this.config.thanarahEmbedKey,
        },
        body: JSON.stringify({ externalUserId: userId, origin }),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      fail('CUSTOMER_AI_EMBED_UNAVAILABLE', 'تعذر بدء جلسة المساعد. حاول لاحقًا.', 503);
    }
    if (!response.ok) {
      fail('CUSTOMER_AI_EMBED_UNAVAILABLE', 'تعذر بدء جلسة المساعد. حاول لاحقًا.', 503);
    }

    const raw: unknown = await response.json().catch(() => null);
    const parsed = z
      .object({
        framePath: z.string().min(1).max(2048),
        code: z.string().min(16).max(2048),
        nonce: z.string().min(16).max(256),
      })
      .safeParse(raw);
    if (!parsed.success) {
      fail('CUSTOMER_AI_EMBED_UNAVAILABLE', 'استجابة بدء جلسة المساعد غير صالحة.', 503);
    }

    const base = new URL(this.config.thanarahApiBaseUrl);
    let frame: URL;
    try {
      if (!parsed.data.framePath.startsWith('/embed/') || parsed.data.framePath.startsWith('//')) {
        throw new Error('Invalid frame path');
      }
      frame = new URL(parsed.data.framePath, base);
    } catch {
      fail('CUSTOMER_AI_EMBED_UNAVAILABLE', 'مسار المساعد غير صالح.', 503);
    }
    const frameQueryKeys = [...frame.searchParams.keys()];
    const safeFrameQuery =
      frameQueryKeys.length === 0 ||
      (frameQueryKeys.length === 1 &&
        frameQueryKeys[0] === 'origin' &&
        frame.searchParams.get('origin') === origin);
    if (
      frame.origin !== base.origin ||
      !safeFrameQuery ||
      frame.hash ||
      frame.username ||
      frame.password
    ) {
      fail('CUSTOMER_AI_EMBED_UNAVAILABLE', 'مسار المساعد غير صالح.', 503);
    }
    return {
      frameUrl: frame.toString(),
      frameOrigin: base.origin,
      integrationId: this.config.thanarahEmbedIntegrationId,
      code: parsed.data.code,
      nonce: parsed.data.nonce,
    };
  }

  async sendWhatsApp(userId: string, input: unknown) {
    const data = parse(sendWhatsAppSchema, input);
    const apiKey = this.config.thanarahApiKey.trim();
    const otpSecret = this.config.whatsappOtpHmacSecret;
    if (!apiKey || otpSecret.length < 32) {
      fail('CUSTOMER_WHATSAPP_UNAVAILABLE', 'إرسال التحقق عبر WhatsApp غير مهيأ.', 503);
    }
    await this.ensureWhatsAppStorage();

    const challenge = await this.store.run(async (tx) => {
      await this.store.fence(tx);
      const account = await this.store.account(tx, userId);
      if (!account.profile) fail('CUSTOMER_PROFILE_REQUIRED', 'أكمل ملف المنشأة أولًا.');
      const phoneE164 = account.profile.phoneE164;
      const existingRaw = await collection(tx, 'customer_whatsapp_challenges').findOne(
        { _id: data.operationId },
        { session: tx.session },
      );
      if (existingRaw) {
        const existing = storedChallenge(existingRaw);
        if (existing.userId !== userId || existing.phoneE164 !== phoneE164) {
          fail('CUSTOMER_IDEMPOTENCY_CONFLICT', 'استُخدم مرجع العملية لبيانات مختلفة.');
        }
        if (existing.expiresAt <= new Date() && existing.status !== 'VERIFIED') {
          await collection(tx, 'customer_whatsapp_challenges').updateOne(
            { _id: existing._id, userId },
            { $set: { status: 'EXPIRED', updatedAt: new Date() } },
            { session: tx.session },
          );
          fail(
            'CUSTOMER_WHATSAPP_CHALLENGE_EXPIRED',
            'انتهت صلاحية رمز التحقق. ابدأ طلبًا جديدًا.',
          );
        }
        return existing;
      }

      if (
        account.phoneVerification.status === 'VERIFIED' &&
        account.phoneVerification.phoneE164 === phoneE164
      ) {
        fail('CUSTOMER_PHONE_ALREADY_VERIFIED', 'تم التحقق من رقم الجوال الحالي بالفعل.');
      }
      const now = new Date();
      const activeRaw = await collection(tx, 'customer_whatsapp_challenges').findOne(
        {
          userId,
          status: { $in: ['SENDING', 'QUEUED'] },
          expiresAt: { $gt: now },
        },
        { session: tx.session, sort: { createdAt: -1 } },
      );
      if (activeRaw) {
        const active = storedChallenge(activeRaw);
        if (active.phoneE164 !== phoneE164) {
          fail('CUSTOMER_PHONE_CHANGED', 'تغير رقم الجوال. احفظ الملف واطلب رمزًا جديدًا.');
        }
        return active;
      }
      const recent = await collection(tx, 'customer_whatsapp_challenges').findOne(
        { userId, createdAt: { $gt: new Date(now.getTime() - 60_000) } },
        { session: tx.session, sort: { createdAt: -1 } },
      );
      if (recent) {
        fail('CUSTOMER_WHATSAPP_RATE_LIMITED', 'انتظر دقيقة قبل طلب رمز جديد.', 429);
      }

      const otp = deriveOtp(otpSecret, userId, data.operationId, phoneE164);
      const challengeId = data.operationId;
      const record = challengeSchema.parse({
        _id: data.operationId,
        userId,
        accountId: account._id,
        phoneE164,
        codeDigest: otpDigest(otpSecret, challengeId, otp),
        consentReference: challengeId,
        consentAcceptedAt: now,
        consentTextVersion: 1,
        status: 'SENDING',
        queueRequestId: null,
        attempts: 0,
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(now.getTime() + 5 * 60_000),
      });
      await collection(tx, 'customer_whatsapp_challenges').insertOne(record, {
        session: tx.session,
      });
      return record;
    });

    if (challenge.status === 'VERIFIED') {
      return { challengeId: challenge._id, status: 'VERIFIED' as const, requestId: null };
    }
    if (challenge.queueRequestId && challenge.status === 'QUEUED') {
      return {
        challengeId: challenge._id,
        status: 'QUEUED' as const,
        requestId: challenge.queueRequestId,
        expiresAt: challenge.expiresAt,
      };
    }

    const otp = deriveOtp(otpSecret, userId, challenge._id, challenge.phoneE164);
    const endpoint = new URL('/api/whatsapp/messages', this.config.thanarahApiBaseUrl);
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'idempotency-key': challenge._id,
        },
        body: JSON.stringify({
          to: challenge.phoneE164,
          type: 'text',
          text: `رمز التحقق لثنارة: ${otp}. صالح لمدة خمس دقائق.`,
          consentReference: challenge.consentReference,
        }),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      fail(
        'CUSTOMER_WHATSAPP_OUTCOME_UNKNOWN',
        'تعذر تأكيد قبول طلب الإرسال. أعد المحاولة بالمرجع نفسه.',
        503,
      );
    }
    if (!response.ok) {
      if (response.status >= 500) {
        fail(
          'CUSTOMER_WHATSAPP_OUTCOME_UNKNOWN',
          'تعذر تأكيد قبول طلب الإرسال. أعد المحاولة بالمرجع نفسه.',
          503,
        );
      }
      fail('CUSTOMER_WHATSAPP_UNAVAILABLE', 'تعذر إرسال رمز التحقق عبر WhatsApp.', 503);
    }
    const payload: unknown = await response.json().catch(() => null);
    const requestId = queueRequestId(payload);
    if (!requestId) {
      fail(
        'CUSTOMER_WHATSAPP_OUTCOME_UNKNOWN',
        'قُبل رد الموفر دون معرّف متابعة صالح. أعد المحاولة بالمرجع نفسه.',
        503,
      );
    }

    await this.store.run(async (tx) => {
      await collection(tx, 'customer_whatsapp_challenges').updateOne(
        { _id: challenge._id, userId, status: { $ne: 'VERIFIED' } },
        {
          $set: {
            status: 'QUEUED',
            queueRequestId: requestId,
            updatedAt: new Date(),
          },
        },
        { session: tx.session },
      );
    });
    return {
      challengeId: challenge._id,
      status: 'QUEUED' as const,
      requestId,
      expiresAt: challenge.expiresAt,
    };
  }

  async verifyWhatsApp(userId: string, input: unknown) {
    const data = parse(verifyWhatsAppSchema, input);
    const otpSecret = this.config.whatsappOtpHmacSecret;
    if (otpSecret.length < 32) {
      fail('CUSTOMER_WHATSAPP_UNAVAILABLE', 'التحقق عبر WhatsApp غير مهيأ.', 503);
    }
    await this.ensureWhatsAppStorage();
    const result = await this.store.run(async (tx) => {
      await this.store.fence(tx);
      const account = await this.store.account(tx, userId);
      const raw = await collection(tx, 'customer_whatsapp_challenges').findOne(
        { _id: data.challengeId, userId },
        { session: tx.session },
      );
      if (!raw) fail('CUSTOMER_WHATSAPP_CHALLENGE_NOT_FOUND', 'طلب التحقق غير متاح.', 404);
      const challenge = storedChallenge(raw);
      const now = new Date();
      if (challenge.status === 'VERIFIED') {
        return account.phoneVerification.status === 'VERIFIED' &&
          account.phoneVerification.phoneE164 === challenge.phoneE164
          ? { kind: 'verified' as const }
          : { kind: 'phone-changed' as const };
      }
      if (challenge.expiresAt <= now || challenge.status === 'EXPIRED') {
        await collection(tx, 'customer_whatsapp_challenges').updateOne(
          { _id: challenge._id, userId },
          { $set: { status: 'EXPIRED', updatedAt: now } },
          { session: tx.session },
        );
        return { kind: 'expired' as const };
      }
      if (!['SENDING', 'QUEUED'].includes(challenge.status)) {
        return { kind: 'unavailable' as const };
      }
      if (challenge.attempts >= 5) return { kind: 'locked' as const };
      if (!account.profile || account.profile.phoneE164 !== challenge.phoneE164) {
        return { kind: 'phone-changed' as const };
      }

      const candidate = Buffer.from(otpDigest(otpSecret, challenge._id, data.code), 'hex');
      const expected = Buffer.from(challenge.codeDigest, 'hex');
      if (!timingSafeEqual(candidate, expected)) {
        await collection(tx, 'customer_whatsapp_challenges').updateOne(
          { _id: challenge._id, userId, attempts: challenge.attempts },
          { $inc: { attempts: 1 }, $set: { updatedAt: now } },
          { session: tx.session },
        );
        return { kind: 'invalid' as const, attemptsLeft: Math.max(0, 4 - challenge.attempts) };
      }

      await this.store.save(tx, 'customer_accounts', account, {
        phoneVerification: {
          status: 'VERIFIED',
          phoneE164: challenge.phoneE164,
          verifiedAt: now,
        },
      });
      await collection(tx, 'customer_whatsapp_challenges').updateOne(
        { _id: challenge._id, userId, status: { $in: ['SENDING', 'QUEUED'] } },
        { $set: { status: 'VERIFIED', updatedAt: now } },
        { session: tx.session },
      );
      return { kind: 'verified' as const };
    });

    if (result.kind === 'expired')
      fail('CUSTOMER_WHATSAPP_CHALLENGE_EXPIRED', 'انتهت صلاحية رمز التحقق. ابدأ طلبًا جديدًا.');
    if (result.kind === 'locked')
      fail(
        'CUSTOMER_WHATSAPP_ATTEMPTS_EXCEEDED',
        'تجاوزت عدد المحاولات. ابدأ طلب تحقق جديدًا.',
        429,
      );
    if (result.kind === 'invalid')
      fail(
        'CUSTOMER_WHATSAPP_CODE_INVALID',
        `رمز التحقق غير صحيح. المحاولات المتبقية: ${result.attemptsLeft}.`,
        400,
      );
    if (result.kind === 'phone-changed')
      fail('CUSTOMER_PHONE_CHANGED', 'تغير رقم الجوال. احفظ الملف واطلب رمزًا جديدًا.');
    if (result.kind === 'unavailable')
      fail('CUSTOMER_WHATSAPP_CHALLENGE_INVALID', 'حالة طلب التحقق لا تسمح بإكماله.');
    return { verified: true as const };
  }

  private async ensureWhatsAppStorage(): Promise<void> {
    let indexes: Array<{ name?: string; expireAfterSeconds?: number }>;
    try {
      const db = await this.store.manager.getDatabase();
      indexes = await db.collection('customer_whatsapp_challenges').listIndexes().toArray();
    } catch {
      fail('CUSTOMER_WHATSAPP_UNAVAILABLE', 'تخزين التحقق غير مهيأ بأمان.', 503);
    }
    if (
      !indexes.some(
        (index) => index.name === 'ttl_customer_whatsapp_expiry' && index.expireAfterSeconds === 0,
      )
    ) {
      fail('CUSTOMER_WHATSAPP_UNAVAILABLE', 'تخزين التحقق غير مهيأ بأمان.', 503);
    }
  }
}

function exactOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && parsed.origin === value ? value : null;
  } catch {
    return null;
  }
}

function deriveOtp(secret: string, userId: string, operationId: string, phone: string): string {
  const digest = createHmac('sha256', secret)
    .update(`thanarah:customer-whatsapp-otp:v1:${userId}:${operationId}:${phone}`)
    .digest();
  return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, '0');
}

function otpDigest(secret: string, challengeId: string, code: string): string {
  return createHmac('sha256', secret)
    .update(`thanarah:customer-whatsapp-verify:v1:${challengeId}:${code}`)
    .digest('hex');
}

function queueRequestId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  let value: unknown;
  if ('requestId' in payload) value = payload.requestId;
  else if ('id' in payload) value = payload.id;
  return typeof value === 'string' && /^[a-z0-9._:-]{1,191}$/iu.test(value) ? value : null;
}

function storedChallenge(raw: unknown): Challenge {
  const result = challengeSchema.safeParse(raw);
  if (!result.success) fail('CUSTOMER_DATA_INVALID', 'تعذر قراءة طلب التحقق بأمان.', 503);
  return result.data;
}
