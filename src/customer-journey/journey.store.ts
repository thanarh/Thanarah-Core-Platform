import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { ClientSession, Db, Document, Filter } from 'mongodb';
import { z } from 'zod';
import { PlatformMongoClientManager } from '../platform-mongo/platform-mongo.client.manager';
import { platformUserSchema } from '../platform-mongo/platform-mongo.models';
import { OperationsStore, canonical, type Work } from '../internal-operations/operations.store';
import type { Permission } from '../internal-operations/operations.model';
import { fail } from '../internal-operations/operations.errors';
import {
  accountSchema,
  catalogSchema,
  defaultCatalog,
  orderSchema,
  type Account,
  type Order,
} from './journey.model';

export type Row = Document & { _id: string };
export interface JourneyTx {
  db: Db;
  session: ClientSession;
}
export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) fail('CUSTOMER_INPUT_INVALID', 'تحقق من الحقول المطلوبة وصيغها.', 400);
  return result.data;
}
export function stored<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) fail('CUSTOMER_DATA_INVALID', 'تعذر التحقق من السجل بأمان.', 503);
  return result.data;
}
export function expectVersion(actual: number, expected: number): void {
  if (actual !== expected)
    fail('CUSTOMER_VERSION_CONFLICT', 'تغير السجل؛ أعد تحميله قبل المتابعة.');
}
export function collection(tx: JourneyTx, name: string) {
  return tx.db.collection<Row>(name);
}
@Injectable()
export class JourneyStore {
  constructor(
    readonly manager: PlatformMongoClientManager,
    readonly company: OperationsStore,
  ) {}
  async run<T>(fn: (tx: JourneyTx) => Promise<T>): Promise<T> {
    const db = await this.manager.getDatabase();
    return this.manager.withTransaction((session) => fn({ db, session }), {
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
    });
  }
  async ready(db: Db): Promise<void> {
    for (const [name, required] of [
      ['customer_accounts', 'ux_customer_user'],
      ['customer_orders', 'ux_customer_open_order'],
    ]) {
      const indexes = await db.collection(name).listIndexes().toArray();
      if (!indexes.some((i) => i.name === required && i.unique))
        fail('CUSTOMER_STORAGE_NOT_READY', 'لم تكتمل تهيئة تخزين رحلة العميل.', 503);
    }
  }
  async command<T>(
    userId: string | null,
    operationId: string,
    action: string,
    input: unknown,
    fn: (tx: JourneyTx) => Promise<{ result: T; orderId?: string; reason?: string }>,
  ): Promise<T> {
    await this.ready(await this.manager.getDatabase());
    const fingerprint = createHash('sha256')
      .update(canonical({ userId, action, input }))
      .digest('hex');
    return this.run(async (tx) => {
      await this.fence(tx);
      if (userId) await this.identity(tx, userId, true);
      const prior = await collection(tx, 'customer_commands').findOne(
        { _id: operationId },
        { session: tx.session },
      );
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          fail('CUSTOMER_IDEMPOTENCY_CONFLICT', 'استُخدم مرجع العملية لبيانات مختلفة.');
        return prior.result as T;
      }
      const completed = await fn(tx);
      await this.event(tx, completed.orderId ?? null, action, userId, completed.reason);
      await collection(tx, 'customer_commands').insertOne(
        {
          _id: operationId,
          userId,
          fingerprint,
          result: completed.result,
          createdAt: new Date(),
        },
        { session: tx.session },
      );
      return completed.result;
    });
  }
  async fence(tx: JourneyTx): Promise<void> {
    await collection(tx, 'company_control').updateOne(
      { _id: 'company' },
      { $inc: { revision: 1 } },
      { session: tx.session, upsert: true },
    );
  }
  async identity(tx: JourneyTx, userId: string, touch = false): Promise<void> {
    const raw = await collection(tx, 'platform_users').findOne(
      { _id: userId },
      { session: tx.session },
    );
    if (!raw || stored(platformUserSchema, raw).status !== 'ACTIVE')
      fail('CUSTOMER_ACCESS_DENIED', 'الحساب غير متاح.', 403);
    if (touch)
      await collection(tx, 'platform_users').updateOne(
        { _id: userId },
        { $inc: { referenceVersion: 1 } },
        { session: tx.session },
      );
  }
  async account(tx: JourneyTx, userId: string): Promise<Account> {
    await this.identity(tx, userId);
    const raw = await collection(tx, 'customer_accounts').findOne(
      { userId },
      { session: tx.session },
    );
    if (!raw) fail('CUSTOMER_ACCOUNT_NOT_FOUND', 'لا يوجد ملف عميل مرتبط بهذا الحساب.', 404);
    return stored(accountSchema, raw);
  }
  async order(tx: JourneyTx, id: string, customerId?: string): Promise<Order> {
    const raw = await collection(tx, 'customer_orders').findOne(
      {
        _id: id,
        ...(customerId ? { customerId } : {}),
      },
      { session: tx.session },
    );
    if (!raw) fail('CUSTOMER_ORDER_NOT_FOUND', 'الطلب غير متاح.', 404);
    return stored(orderSchema, raw);
  }
  async catalog(tx: JourneyTx) {
    const raw = await collection(tx, 'customer_settings').findOne(
      { _id: 'catalog' },
      { session: tx.session },
    );
    return raw ? stored(catalogSchema, raw) : defaultCatalog();
  }
  async save<T extends { _id: string; version: number; updatedAt: Date }>(
    tx: JourneyTx,
    name: string,
    current: T,
    changes: Partial<T>,
  ): Promise<T> {
    const result = { ...current, ...changes, version: current.version + 1, updatedAt: new Date() };
    const updated = await collection(tx, name).replaceOne(
      { _id: current._id, version: current.version },
      result,
      { session: tx.session },
    );
    if (updated.matchedCount !== 1)
      fail('CUSTOMER_VERSION_CONFLICT', 'تغير السجل؛ أعد تحميله قبل المتابعة.');
    return result;
  }
  async event(
    tx: JourneyTx,
    orderId: string | null,
    action: string,
    actorUserId: string | null,
    reason?: string,
    fromVersion?: number,
    toVersion?: number,
  ): Promise<void> {
    await collection(tx, 'customer_events').insertOne(
      {
        _id: randomUUID(),
        orderId,
        action,
        actorUserId,
        at: new Date(),
        reason: reason ?? null,
        fromVersion: fromVersion ?? null,
        toVersion: toVersion ?? null,
      },
      { session: tx.session },
    );
  }
  scope(w: Work): Filter<Row> {
    return w.actor.permissions.includes('customers.manage_all')
      ? {}
      : { managerId: w.actor.employeeId ?? '__none__' };
  }
  async adminOrder(w: Work, id: string): Promise<Order> {
    const raw = await collection(w, 'customer_orders').findOne(
      { _id: id, ...this.scope(w) },
      { session: w.session },
    );
    if (!raw) fail('CUSTOMER_ORDER_NOT_FOUND', 'الطلب غير متاح ضمن نطاق صلاحياتك.', 404);
    return stored(orderSchema, raw);
  }
  adminCommand<T>(
    userId: string,
    operationId: string,
    action: string,
    input: unknown,
    permission: Permission,
    run: (
      w: Work,
    ) => Promise<{ result: T; orderId: string; fromVersion?: number; toVersion?: number }>,
  ): Promise<T> {
    return this.company.command(
      userId,
      operationId,
      action,
      input,
      async (w) => {
        const result = await run(w);
        const reason =
          input && typeof input === 'object' && 'reason' in input
            ? String(input.reason).slice(0, 500)
            : undefined;
        await this.event(
          w,
          result.orderId,
          action,
          userId,
          reason,
          result.fromVersion,
          result.toVersion,
        );
        return { ...result, recordId: result.orderId, resource: 'customer_journey' };
      },
      permission,
    );
  }
}
