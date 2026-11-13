import { Injectable } from '@nestjs/common';
import type { Filter, Document } from 'mongodb';
import { z } from 'zod';
import {
  BUILTIN_ROLES,
  READ_PERMISSIONS,
  WRITE_PERMISSIONS,
  schemas,
  type DataMap,
  type OpsRecord,
  type Resource,
  type commandSchema,
} from './operations.model';
import { journalTotals } from './operations.calculation';
import { fail } from './operations.errors';
import { OperationsStore, type Work } from './operations.store';

@Injectable()
export class OperationsRecords {
  constructor(readonly store: OperationsStore) {}
  parse<K extends Resource>(kind: K, input: unknown): DataMap[K] {
    const parsed = schemas[kind].safeParse(input);
    if (!parsed.success) fail('COMPANY_INPUT_INVALID', 'تحقق من الحقول المطلوبة وصيغها.', 400);
    return parsed.data as DataMap[K];
  }
  requestVisible(w: Work, row: OpsRecord<'requests'>): boolean {
    return (
      w.actor.isRoot ||
      w.actor.permissions.includes('requests.approve') ||
      w.actor.permissions.includes('dashboard.ceo') ||
      w.actor.permissions.includes('dashboard.director') ||
      row.createdBy === w.actor.userId ||
      row.data.ownerId === w.actor.employeeId ||
      (w.actor.permissions.includes('dashboard.cto') && row.data.category === 'TECHNICAL')
    );
  }
  requestFilter(w: Work): Document {
    if (
      w.actor.isRoot ||
      ['requests.approve', 'dashboard.ceo', 'dashboard.director'].some((p) =>
        w.actor.permissions.includes(p as 'requests.approve'),
      )
    )
      return {};
    return {
      $or: [
        { createdBy: w.actor.userId },
        ...(w.actor.employeeId ? [{ 'data.ownerId': w.actor.employeeId }] : []),
        ...(w.actor.permissions.includes('dashboard.cto')
          ? [{ 'data.category': 'TECHNICAL' }]
          : []),
      ],
    };
  }
  async list(userId: string, kind: Resource, query: { page: number; limit: number; q: string }) {
    return this.store.read(userId, READ_PERMISSIONS[kind], async (w) => {
      const filter: Filter<Document & { _id: string }> = {
        kind,
        ...(kind === 'requests' ? this.requestFilter(w) : {}),
      };
      if (query.q) {
        const regex = query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        filter.$and = [
          {
            $or: ['name', 'title', 'memo', 'code'].map((key) => ({
              [`data.${key}`]: { $regex: regex, $options: 'i' },
            })),
          },
        ];
      }
      const total = await this.store
        .collection(w.db)
        .countDocuments(filter, { session: w.session });
      const rows = await this.store
        .collection(w.db)
        .find(filter, { session: w.session })
        .sort({ updatedAt: -1, _id: 1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .toArray();
      const items: unknown[] = rows.map((r) => this.store.parse(r));
      if (kind === 'roles') {
        // Builtins are a separate catalog, supplied in session; pagination is for custom records only.
      }
      return { items, total, page: query.page, limit: query.limit };
    });
  }
  async activeEmployee(w: Work, id: string) {
    const employee = await this.store.get(w, 'employees', id);
    if (employee.data.status !== 'ACTIVE')
      fail('COMPANY_REFERENCE_INACTIVE', 'الموظف المحدد غير نشط.');
    return employee;
  }
  async activeAccount(w: Work, id: string) {
    const account = await this.store.get(w, 'accounts', id);
    if (account.data.status !== 'ACTIVE')
      fail('COMPANY_REFERENCE_INACTIVE', 'الحساب المحاسبي غير نشط.');
    return account;
  }
  async validate<K extends Resource>(
    w: Work,
    kind: K,
    data: DataMap[K],
    previous?: OpsRecord<K>,
  ): Promise<void> {
    if (kind === 'units') {
      const d = data as DataMap['units'];
      if (d.unitType === 'COMPANY') {
        if (d.parentId) fail('COMPANY_HIERARCHY_INVALID', 'الشركة هي المستوى الأعلى.', 400);
        const root = await this.store.collection(w.db).findOne(
          {
            kind: 'units',
            'data.unitType': 'COMPANY',
            'data.status': 'ACTIVE',
            ...(previous ? { _id: { $ne: previous._id } } : {}),
          },
          { session: w.session },
        );
        if (root && d.status === 'ACTIVE') fail('COMPANY_ROOT_EXISTS', 'يوجد بالفعل سجل شركة نشط.');
      } else {
        if (!d.parentId || d.parentId === previous?._id)
          fail('COMPANY_HIERARCHY_INVALID', 'حدد الجهة الأعلى الصحيحة.', 400);
        const parent = await this.store.get(w, 'units', d.parentId);
        if (
          parent.data.status !== 'ACTIVE' ||
          parent.data.unitType !== (d.unitType === 'DEPARTMENT' ? 'COMPANY' : 'DEPARTMENT')
        ) {
          fail('COMPANY_HIERARCHY_INVALID', 'الإدارة تتبع شركة والقسم يتبع إدارة نشطة.', 400);
        }
      }
      if (previous) {
        const children = await this.store.all(w, 'units', {
          'data.parentId': previous._id,
          'data.status': 'ACTIVE',
        });
        if (
          children.some(
            (c) => (c.data.unitType === 'DEPARTMENT' ? 'COMPANY' : 'DEPARTMENT') !== d.unitType,
          )
        )
          fail('COMPANY_UNIT_IN_USE', 'توجد جهات تابعة تعتمد على نوع هذه الجهة.');
        if (
          d.status === 'ARCHIVED' &&
          (children.length ||
            (await this.store
              .collection(w.db)
              .findOne(
                { kind: 'employees', 'data.unitId': previous._id, 'data.status': 'ACTIVE' },
                { session: w.session },
              )))
        )
          fail('COMPANY_UNIT_IN_USE', 'انقل الموظفين والجهات التابعة قبل الأرشفة.');
      }
    } else if (kind === 'employees') {
      const d = data as DataMap['employees'];
      const old = previous?.data as DataMap['employees'] | undefined;
      const changedAccess =
        !old ||
        old.userId !== d.userId ||
        old.status !== d.status ||
        JSON.stringify([...old.roleIds].sort()) !== JSON.stringify([...d.roleIds].sort());
      if (changedAccess && (d.roleIds.length || d.userId || old?.roleIds.length || old?.userId)) {
        this.store.require(w.actor, 'access.manage');
        if (old?.userId === w.actor.userId)
          fail(
            'COMPANY_SELF_ACCESS_CHANGE',
            'لا يمكن تعديل صلاحيات أو ربط أو حالة ملفك بنفسك.',
            403,
          );
      }
      const unit = await this.store.get(w, 'units', d.unitId);
      if (unit.data.status !== 'ACTIVE')
        fail('COMPANY_REFERENCE_INACTIVE', 'الجهة التنظيمية غير نشطة.');
      for (const roleId of d.roleIds) {
        if (!BUILTIN_ROLES[roleId]) {
          const role = await this.store.get(w, 'roles', roleId);
          if (role.data.status !== 'ACTIVE')
            fail('COMPANY_REFERENCE_INACTIVE', 'الدور الوظيفي غير نشط.');
        }
      }
      if (new Set(d.roleIds).size !== d.roleIds.length)
        fail('COMPANY_INPUT_INVALID', 'لا تكرر الدور الوظيفي.', 400);
      if (d.userId) {
        const user = await w.db
          .collection<Document & { _id: string }>('platform_users')
          .findOne({ _id: d.userId, status: 'ACTIVE' }, { session: w.session });
        if (!user)
          fail('COMPANY_USER_UNAVAILABLE', 'اربط الموظف بحساب منصة نشط موجود مسبقًا.', 400);
        await w.db
          .collection<Document & { _id: string }>('platform_users')
          .updateOne({ _id: d.userId }, { $inc: { referenceVersion: 1 } }, { session: w.session });
        const assigned = await this.store.collection(w.db).findOne(
          {
            kind: 'employees',
            'data.userId': d.userId,
            ...(previous ? { _id: { $ne: previous._id } } : {}),
          },
          { session: w.session },
        );
        if (assigned) fail('COMPANY_USER_ALREADY_LINKED', 'الحساب مرتبط بموظف آخر.');
      }
    } else if (kind === 'roles') {
      const d = data as DataMap['roles'];
      if (previous && w.actor.roles.includes(previous._id))
        fail('COMPANY_SELF_ACCESS_CHANGE', 'لا يمكنك تعديل دور مرتبط بصلاحياتك الحالية.', 403);
      if (new Set(d.permissions).size !== d.permissions.length)
        fail('COMPANY_INPUT_INVALID', 'لا تكرر الصلاحيات.', 400);
    } else if (kind === 'contracts') {
      const d = data as DataMap['contracts'];
      await this.activeEmployee(w, d.employeeId);
      if (d.endDate && d.endDate < d.startDate)
        fail('COMPANY_CONTRACT_DATES', 'نهاية العقد يجب ألا تسبق بدايته.', 400);
    } else if (kind === 'clients') {
      await this.activeEmployee(w, (data as DataMap['clients']).ownerId);
    } else if (kind === 'requests') {
      await this.activeEmployee(w, (data as DataMap['requests']).ownerId);
    } else if (kind === 'accounts') {
      const d = data as DataMap['accounts'];
      const existing = await this.store.collection(w.db).findOne(
        {
          kind: 'accounts',
          'data.code': d.code,
          ...(previous ? { _id: { $ne: previous._id } } : {}),
        },
        { session: w.session },
      );
      if (existing) fail('COMPANY_ACCOUNT_CODE_EXISTS', 'رمز الحساب مستخدم.');
      if (previous) {
        const old = previous.data as DataMap['accounts'];
        const inUse = await this.store.collection(w.db).findOne(
          {
            $or: [
              { kind: 'journals', 'data.lines.accountId': previous._id },
              {
                kind: 'policies',
                $or: [
                  { 'data.debitAccountId': previous._id },
                  { 'data.creditAccountId': previous._id },
                ],
              },
            ],
          },
          { session: w.session },
        );
        if (inUse && (d.type !== old.type || d.code !== old.code || d.status !== old.status))
          fail(
            'COMPANY_ACCOUNT_IN_USE',
            'لا يمكن تغيير نوع أو رمز أو حالة حساب مرتبط بقيود أو سياسات.',
          );
      }
    } else if (kind === 'policies') {
      const d = data as DataMap['policies'];
      if (d.effectiveTo && d.effectiveTo < d.effectiveFrom)
        fail('COMPANY_POLICY_DATES', 'راجع فترة سريان السياسة.', 400);
      if (d.type === 'PAYROLL' && d.rateBps !== 10000)
        fail(
          'COMPANY_PAYROLL_POLICY',
          'سياسة الرواتب الشهرية تتطلب 100%؛ لا يوجد احتساب جزئي تلقائي.',
          400,
        );
      if (d.debitAccountId === d.creditAccountId)
        fail('COMPANY_POLICY_ACCOUNTS', 'حسابا المدين والدائن يجب أن يختلفا.', 400);
      const debit = await this.activeAccount(w, d.debitAccountId);
      const credit = await this.activeAccount(w, d.creditAccountId);
      if (
        debit.data.type !== (d.type === 'PROFIT' ? 'EQUITY' : 'EXPENSE') ||
        credit.data.type !== 'LIABILITY'
      ) {
        fail(
          'COMPANY_POLICY_ACCOUNTS',
          'حدد حساب مصروف للرواتب/العمولات أو حقوق ملكية للأرباح، ومقابله التزام مستحق.',
          400,
        );
      }
    } else if (kind === 'journals') {
      const d = data as DataMap['journals'];
      if (d.clientId) await this.store.get(w, 'clients', d.clientId);
      try {
        journalTotals(d.lines);
      } catch {
        fail(
          'COMPANY_JOURNAL_UNBALANCED',
          'كل سطر له طرف موجب واحد، ومجموع المدين يساوي الدائن.',
          400,
        );
      }
      for (const line of d.lines) await this.activeAccount(w, line.accountId);
      if (d.kind === 'DEPOSIT' || d.kind === 'WITHDRAWAL') {
        if (d.lines.length !== 2 || d.lines[0].accountId === d.lines[1].accountId)
          fail(
            'COMPANY_TRANSFER_ACCOUNTS',
            'السحب والإيداع تسجيل محاسبي بين حسابَي أصول مختلفين.',
            400,
          );
        for (const line of d.lines) {
          const account = await this.activeAccount(w, line.accountId);
          if (account.data.type !== 'ASSET')
            fail('COMPANY_TRANSFER_ACCOUNTS', 'السحب والإيداع يتطلبان حسابَي أصول.', 400);
        }
      }
    }
  }
  async write(userId: string, kind: Resource, command: z.infer<typeof commandSchema>, id?: string) {
    const data = this.parse(kind, command.data);
    return this.store.command(
      userId,
      command.operationId,
      `${id ? 'update' : 'create'}.${kind}${id ? `.${id}` : ''}`,
      command,
      async (w) => {
        this.store.require(w.actor, WRITE_PERMISSIONS[kind]);
        const previous = id ? await this.store.get(w, kind, id) : undefined;
        if (previous && previous.version !== command.version)
          fail('COMPANY_VERSION_CONFLICT', 'تغير السجل؛ أعد تحميله قبل الحفظ.');
        if (!previous && command.version)
          fail('COMPANY_INPUT_INVALID', 'لا ترسل نسخة عند الإنشاء.', 400);
        if (
          kind === 'requests' &&
          previous &&
          !this.requestVisible(w, previous as OpsRecord<'requests'>)
        )
          fail('COMPANY_PERMISSION_DENIED', 'الطلب خارج نطاقك.', 403);
        const status = 'status' in data ? data.status : undefined;
        if (['contracts', 'policies', 'requests', 'journals'].includes(kind)) {
          if (
            status !== 'DRAFT' ||
            (previous && (previous.data as { status: string }).status !== 'DRAFT')
          )
            fail(
              'COMPANY_DRAFT_REQUIRED',
              'التعديل المباشر للمسودات فقط؛ استخدم إجراءات الاعتماد.',
            );
        }
        if (kind === 'journals') {
          const d = data as DataMap['journals'];
          if (
            !['GENERAL', 'DEPOSIT', 'WITHDRAWAL'].includes(d.kind) ||
            d.sourceKey ||
            d.calculation ||
            d.reversalOf ||
            (previous?.data as DataMap['journals'] | undefined)?.sourceKey
          ) {
            fail(
              'COMPANY_GENERATED_JOURNAL',
              'القيود المحتسبة والعكسية ينشئها النظام ولا تُعدل يدويًا.',
              400,
            );
          }
        }
        await this.validate(w, kind, data, previous);
        const result = previous
          ? await this.store.save(w, previous, data)
          : await this.store.insert(w, kind, data);
        return {
          result,
          recordId: result._id,
          resource: kind,
          fromVersion: previous?.version,
          toVersion: result.version,
        };
      },
      WRITE_PERMISSIONS[kind],
    );
  }
}
