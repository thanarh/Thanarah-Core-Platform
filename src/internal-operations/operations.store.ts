import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { ClientSession, Db, Document, Filter } from 'mongodb';
import { PlatformMongoClientManager } from '../platform-mongo/platform-mongo.client.manager';
import {
  platformUserSchema,
  platformUserRoleSchema,
  platformRoleSchema,
} from '../platform-mongo/platform-mongo.models';
import {
  BUILTIN_ROLES,
  PERMISSIONS,
  type AnyRecord,
  type OpsRecord,
  type Permission,
  type Resource,
  schemas,
  recordBaseSchema,
} from './operations.model';
import { OperationsError, fail } from './operations.errors';

export interface CompanyContext {
  userId: string;
  isRoot: boolean;
  permissions: Permission[];
  roles: string[];
  employeeId?: string;
}
type Stored = Document & { _id: string };
export interface Work {
  db: Db;
  session: ClientSession;
  actor: CompanyContext;
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
@Injectable()
export class OperationsStore {
  constructor(readonly manager: PlatformMongoClientManager) {}
  collection(db: Db) {
    return db.collection<Stored>('company_records');
  }

  async context(db: Db, userId: string, session: ClientSession): Promise<CompanyContext> {
    const user = await db
      .collection<Stored>('platform_users')
      .findOne({ _id: userId, status: 'ACTIVE' }, { session });
    if (!user) fail('COMPANY_ACCESS_DENIED', 'الحساب غير نشط.', 403);
    if (!platformUserSchema.safeParse(user).success)
      fail('COMPANY_IDENTITY_INVALID', 'تعذر التحقق من سجل الهوية بأمان.', 503);
    const assignments = await db
      .collection('platform_user_roles')
      .find({ userId }, { session })
      .toArray();
    if (assignments.some((assignment) => !platformUserRoleSchema.safeParse(assignment).success))
      fail('COMPANY_IDENTITY_INVALID', 'تعذر التحقق من أدوار الحساب.', 503);
    const roles = await db
      .collection<Stored>('platform_roles')
      .find({ _id: { $in: assignments.map((a) => a.roleId as string) } }, { session })
      .toArray();
    if (
      roles.some((role) => !platformRoleSchema.safeParse(role).success) ||
      assignments.some((assignment) => !roles.some((role) => role._id === assignment.roleId))
    )
      fail('COMPANY_IDENTITY_INVALID', 'مراجع أدوار المنصة غير مكتملة.', 503);
    const isRoot = roles.some((r) => r.code === 'OWNER' || r.code === 'SUPER_ADMIN');
    if (isRoot) return { userId, isRoot, permissions: [...PERMISSIONS], roles: ['PLATFORM_OWNER'] };
    const employee = await this.collection(db).findOne(
      { kind: 'employees', 'data.userId': userId, 'data.status': 'ACTIVE' },
      { session },
    );
    if (!employee) fail('COMPANY_ACCESS_DENIED', 'لا يوجد ملف موظف نشط مرتبط بهذا الحساب.', 403);
    const profile = this.parse(employee) as OpsRecord<'employees'>;
    const granted = new Set<Permission>();
    for (const roleId of profile.data.roleIds) {
      const builtin = BUILTIN_ROLES[roleId];
      if (builtin) {
        builtin.permissions.forEach((p) => granted.add(p));
        continue;
      }
      const role = await this.collection(db).findOne(
        { _id: roleId, kind: 'roles', 'data.status': 'ACTIVE' },
        { session },
      );
      if (role)
        (this.parse(role) as OpsRecord<'roles'>).data.permissions.forEach((p) => granted.add(p));
    }
    return {
      userId,
      isRoot,
      employeeId: profile._id,
      permissions: [...granted],
      roles: profile.data.roleIds,
    };
  }
  require(actor: CompanyContext, permission: Permission): void {
    if (!actor.permissions.includes(permission))
      fail('COMPANY_PERMISSION_DENIED', 'لا تملك صلاحية هذا الإجراء.', 403);
  }
  async read<T>(
    userId: string,
    permission: Permission | undefined,
    run: (w: Work) => Promise<T>,
  ): Promise<T> {
    const db = await this.manager.getDatabase();
    return this.manager.withTransaction(
      async (session) => {
        const actor = await this.context(db, userId, session);
        if (permission) this.require(actor, permission);
        return run({ db, session, actor });
      },
      { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
    );
  }
  async command<T>(
    userId: string,
    operationId: string,
    operation: string,
    input: unknown,
    run: (w: Work) => Promise<{
      result: T;
      recordId: string;
      resource: string;
      fromVersion?: number;
      toVersion?: number;
    }>,
    permission: Permission,
  ): Promise<T> {
    const db = await this.manager.getDatabase();
    const fingerprint = createHash('sha256')
      .update(canonical({ userId, operation, input }))
      .digest('hex');
    try {
      return await this.manager.withTransaction(
        async (session) => {
          // All company writes, including role edits, participate in one company-wide fence.
          await db
            .collection<Stored>('company_control')
            .updateOne({ _id: 'company' }, { $inc: { revision: 1 } }, { upsert: true, session });
          const actor = await this.context(db, userId, session);
          this.require(actor, permission);
          await db
            .collection<Stored>('platform_users')
            .updateOne(
              { _id: userId, status: 'ACTIVE' },
              { $inc: { referenceVersion: 1 } },
              { session },
            );
          const prior = await db
            .collection<Stored>('company_commands')
            .findOne({ _id: operationId }, { session });
          if (prior) {
            if (prior.fingerprint !== fingerprint)
              fail('COMPANY_IDEMPOTENCY_CONFLICT', 'استُخدم مرجع العملية لطلب مختلف.');
            return prior.result as T;
          }
          const completed = await run({ db, session, actor });
          await db.collection<Stored>('company_audit').insertOne(
            {
              _id: operationId,
              actorUserId: userId,
              action: operation,
              resource: completed.resource,
              recordId: completed.recordId,
              at: new Date(),
              fromVersion: completed.fromVersion ?? null,
              toVersion: completed.toVersion ?? null,
              ...(input &&
              typeof input === 'object' &&
              'reason' in input &&
              typeof input.reason === 'string'
                ? { reason: input.reason.slice(0, 500) }
                : {}),
            },
            { session },
          );
          await db.collection<Stored>('company_commands').insertOne(
            {
              _id: operationId,
              actorUserId: userId,
              fingerprint,
              result: completed.result,
              createdAt: new Date(),
            },
            { session },
          );
          return completed.result;
        },
        { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
      );
    } catch (error) {
      if (error instanceof OperationsError) throw error;
      throw error;
    }
  }
  parse(raw: Stored): AnyRecord {
    if (!recordBaseSchema.safeParse(raw).success)
      fail('COMPANY_DATA_INVALID', 'تعذر التحقق من مصدر السجل وإصداره.', 503);
    const kind = raw.kind as Resource;
    if (!schemas[kind]) fail('COMPANY_DATA_INVALID', 'تعذر قراءة السجل بأمان.', 503);
    const parsed = schemas[kind].safeParse(raw.data);
    if (!parsed.success) fail('COMPANY_DATA_INVALID', 'تعذر قراءة السجل بأمان.', 503);
    if (
      'status' in parsed.data &&
      ['APPROVED', 'POSTED'].includes(parsed.data.status) &&
      (!raw.approvedBy || !raw.approvedAt)
    ) {
      fail('COMPANY_DATA_INVALID', 'لا يحتوي السجل المعتمد على دليل مراجعة صالح.', 503);
    }
    return { ...raw, data: parsed.data } as AnyRecord;
  }
  async get<K extends Resource>(w: Work, kind: K, id: string): Promise<OpsRecord<K>> {
    const row = await this.collection(w.db).findOne({ _id: id, kind }, { session: w.session });
    if (!row) fail('COMPANY_RECORD_NOT_FOUND', 'السجل المطلوب غير موجود.', 404);
    return this.parse(row) as OpsRecord<K>;
  }
  async all<K extends Resource>(
    w: Work,
    kind: K,
    filter: Filter<Stored> = {},
  ): Promise<OpsRecord<K>[]> {
    const rows = await this.collection(w.db)
      .find({ ...filter, kind }, { session: w.session })
      .toArray();
    return rows.map((row) => this.parse(row) as OpsRecord<K>);
  }
  async insert<K extends Resource>(
    w: Work,
    kind: K,
    data: OpsRecord<K>['data'],
  ): Promise<OpsRecord<K>> {
    const result = {
      _id: randomUUID(),
      kind,
      data,
      version: 1,
      createdBy: w.actor.userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await this.collection(w.db).insertOne(result, { session: w.session });
    return result;
  }
  async save<K extends Resource>(
    w: Work,
    row: OpsRecord<K>,
    data: OpsRecord<K>['data'],
    approval = false,
  ): Promise<OpsRecord<K>> {
    const result = {
      ...row,
      data,
      version: row.version + 1,
      updatedAt: new Date(),
      ...(approval ? { approvedBy: w.actor.userId, approvedAt: new Date() } : {}),
    };
    const updated = await this.collection(w.db).replaceOne(
      { _id: row._id, kind: row.kind, version: row.version },
      result,
      { session: w.session },
    );
    if (updated.modifiedCount !== 1)
      fail('COMPANY_VERSION_CONFLICT', 'تغير السجل؛ أعد تحميله قبل المحاولة.');
    return result;
  }
}
