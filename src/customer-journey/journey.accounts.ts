import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PasswordHasherService } from '../auth/security/password-hasher.service';
import { PasswordPolicyService } from '../auth/security/password-policy.service';
import { platformUserSchema, documentTimestamps } from '../platform-mongo/platform-mongo.models';
import { fail } from '../internal-operations/operations.errors';
import { JourneyStore, collection, parse, stored, expectVersion } from './journey.store';
import { JourneyIntegrations } from './journey.integrations';
import {
  accountSchema,
  command,
  version,
  profileSchema,
  orderSchema,
  registerSchema,
  WHATSAPP,
  defaultCatalog,
} from './journey.model';
@Injectable()
export class JourneyAccounts {
  constructor(
    readonly store: JourneyStore,
    readonly passwords: PasswordHasherService,
    readonly policy: PasswordPolicyService,
    readonly integrations: JourneyIntegrations,
  ) {}
  async publicCatalog() {
    return this.store.run(async (tx) => {
      const catalog = await this.store.catalog(tx);
      const live = catalog.live ?? defaultCatalog().draft;
      return {
        version: catalog.liveVersion,
        registrationOpen: live.registrationOpen,
        ordersOpen: live.ordersOpen,
        termsText: catalog.live?.termsText ?? '',
        services: catalog.live?.services.filter((x) => x.published) ?? [],
        packages: catalog.live?.packages.filter((x) => x.published) ?? [],
        documents: catalog.live?.documents ?? [],
        whatsapp: WHATSAPP,
      };
    });
  }
  async register(input: unknown): Promise<{ registered: true }> {
    const data = parse(registerSchema, input);
    this.policy.validate(data.password);
    const passwordHash = await this.passwords.hash(data.password);
    return this.store.command(null, data.operationId, 'customer.register', data, async (tx) => {
      const catalog = await this.store.catalog(tx);
      if (!(catalog.live ?? defaultCatalog().draft).registrationOpen)
        fail('CUSTOMER_REGISTRATION_CLOSED', 'التسجيل مغلق حاليًا.', 403);
      const exists = await collection(tx, 'platform_users').findOne(
        { email: data.email },
        { session: tx.session, collation: { locale: 'en', strength: 1 } },
      );
      if (exists)
        fail(
          'CUSTOMER_REGISTRATION_CONFLICT',
          'تعذر إنشاء الحساب بهذه البيانات. استخدم تسجيل الدخول أو راجع الدعم.',
        );
      const now = new Date(),
        userId = randomUUID();
      const user = platformUserSchema.parse({
        _id: userId,
        ...documentTimestamps(),
        schemaVersion: 1,
        email: data.email,
        fullName: data.fullName,
        passwordHash,
        status: 'ACTIVE',
        tokenVersion: 0,
        failedLoginAttempts: 0,
        lockedUntil: null,
      });
      try {
        await collection(tx, 'platform_users').insertOne(user, { session: tx.session });
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 11000)
          fail('CUSTOMER_REGISTRATION_CONFLICT', 'تعذر إنشاء الحساب بهذه البيانات.');
        throw error;
      }
      const account = accountSchema.parse({
        _id: randomUUID(),
        userId,
        email: data.email,
        fullName: data.fullName,
        profile: null,
        version: 1,
        phoneVerification: { status: 'UNVERIFIED', phoneE164: null, verifiedAt: null },
        createdAt: now,
        updatedAt: now,
      });
      await collection(tx, 'customer_accounts').insertOne(account, { session: tx.session });
      return { result: { registered: true as const } };
    });
  }
  async me(userId: string) {
    return this.store.run(async (tx) => {
      const account = await this.store.account(tx, userId);
      const orders = await collection(tx, 'customer_orders')
        .find({ customerId: account._id }, { session: tx.session })
        .sort({ createdAt: -1 })
        .limit(100)
        .toArray();
      return { account, orders: orders.map((x) => stored(orderSchema, x)), whatsapp: WHATSAPP };
    });
  }
  async profile(userId: string, input: unknown) {
    const data = parse(z.object({ ...command, version, profile: profileSchema }).strict(), input);
    return this.store.command(userId, data.operationId, 'customer.profile', data, async (tx) => {
      const account = await this.store.account(tx, userId);
      expectVersion(account.version, data.version);
      const phoneChanged = data.profile.phoneE164 !== account.profile?.phoneE164;
      const updated = await this.store.save(tx, 'customer_accounts', account, {
        profile: data.profile,
        ...(phoneChanged
          ? {
              phoneVerification: {
                status: 'UNVERIFIED' as const,
                phoneE164: data.profile.phoneE164,
                verifiedAt: null,
              },
            }
          : {}),
      });
      return { result: updated };
    });
  }
  sendWhatsApp(userId: string, input: unknown) {
    return this.integrations.sendWhatsApp(userId, input);
  }
  verifyWhatsApp(userId: string, input: unknown) {
    return this.integrations.verifyWhatsApp(userId, input);
  }
}
