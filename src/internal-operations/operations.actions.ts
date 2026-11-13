import { Injectable } from '@nestjs/common';
import type { z } from 'zod';
import {
  actionSchema,
  WRITE_PERMISSIONS,
  type OpsRecord,
  type Permission,
  type Resource,
} from './operations.model';
import { fail } from './operations.errors';
import { OperationsRecords } from './operations.records';
import { OperationsFinance } from './operations.finance';
import { OperationsStore, type Work } from './operations.store';

@Injectable()
export class OperationsActions {
  constructor(
    readonly store: OperationsStore,
    readonly records: OperationsRecords,
    readonly finance: OperationsFinance,
  ) {}
  independent(w: Work, row: OpsRecord) {
    if (row.createdBy === w.actor.userId)
      fail(
        'COMPANY_INDEPENDENT_REVIEW_REQUIRED',
        'يلزم مراجع آخر؛ لا يمكنك اعتماد أو ترحيل ما أنشأته بنفسك.',
        403,
      );
  }
  permission(kind: Resource, action: z.infer<typeof actionSchema>['action']): Permission {
    if (action === 'cancel') return WRITE_PERMISSIONS[kind];
    if (kind === 'journals') return action === 'post' ? 'finance.post' : 'finance.manage';
    if (kind === 'policies') return action === 'approve' ? 'policies.approve' : 'policies.manage';
    if (kind === 'contracts') return action === 'approve' ? 'hr.approve' : 'hr.manage';
    return ['approve', 'reject'].includes(action) ? 'requests.approve' : 'requests.manage';
  }
  async apply(userId: string, kind: Resource, id: string, input: z.infer<typeof actionSchema>) {
    const permission = this.permission(kind, input.action);
    return this.store.command(
      userId,
      input.operationId,
      `${input.action}.${kind}.${id}`,
      input,
      async (w) => {
        const row = await this.store.get(w, kind, id);
        if (row.version !== input.version)
          fail('COMPANY_VERSION_CONFLICT', 'تغير السجل؛ أعد تحميله.');
        if (input.action === 'cancel') {
          if (
            !['contracts', 'policies', 'journals', 'requests'].includes(kind) ||
            !('status' in row.data) ||
            row.data.status !== 'DRAFT'
          )
            fail('COMPANY_ACTION_INVALID', 'يمكن إلغاء المسودات فقط.', 400);
          if (
            row.kind === 'requests' &&
            !this.records.requestVisible(w, row as OpsRecord<'requests'>)
          )
            fail('COMPANY_PERMISSION_DENIED', 'الطلب خارج نطاقك.', 403);
          const result = await this.store.save(w, row, {
            ...row.data,
            status: 'CANCELLED',
          } as OpsRecord['data']);
          return {
            result,
            resource: kind,
            recordId: result._id,
            fromVersion: row.version,
            toVersion: result.version,
          };
        }
        let result: OpsRecord | undefined;
        if (kind === 'contracts')
          result = await this.contract(w, row as OpsRecord<'contracts'>, input.action);
        else if (kind === 'policies')
          result = await this.policy(w, row as OpsRecord<'policies'>, input.action);
        else if (kind === 'requests')
          result = await this.request(w, row as OpsRecord<'requests'>, input);
        else if (kind === 'journals')
          result = await this.journal(w, row as OpsRecord<'journals'>, input);
        if (!result) fail('COMPANY_ACTION_INVALID', 'هذا الإجراء غير متاح للسجل.', 400);
        return {
          result,
          resource: kind,
          recordId: result._id,
          fromVersion: row.version,
          toVersion: result.version,
        };
      },
      permission,
    );
  }
  async contract(w: Work, row: OpsRecord<'contracts'>, action: string) {
    if (action === 'approve' && row.data.status === 'DRAFT') {
      this.independent(w, row);
      const beneficiary = await this.records.activeEmployee(w, row.data.employeeId);
      if (beneficiary.data.userId === w.actor.userId)
        fail('COMPANY_BENEFICIARY_REVIEW', 'لا يمكنك اعتماد عقدك الشخصي.', 403);
      await this.records.validate(w, 'contracts', row.data);
      const contracts = await this.store.all(w, 'contracts', {
        'data.employeeId': row.data.employeeId,
        'data.status': 'APPROVED',
      });
      if (
        contracts.some(
          (c) =>
            c.data.startDate <= (row.data.endDate ?? '9999-12-31') &&
            (c.data.endDate ?? '9999-12-31') >= row.data.startDate,
        )
      ) {
        fail('COMPANY_CONTRACT_OVERLAP', 'يوجد عقد معتمد متداخل في الفترة لنفس الموظف.');
      }
      return this.store.save(w, row, { ...row.data, status: 'APPROVED' }, true);
    }
    if (action === 'end' && row.data.status === 'APPROVED') {
      this.independent(w, row);
      return this.store.save(w, row, { ...row.data, status: 'ENDED' }, true);
    }
    return undefined;
  }
  async policy(w: Work, row: OpsRecord<'policies'>, action: string) {
    if (action === 'approve' && row.data.status === 'DRAFT') {
      this.independent(w, row);
      await this.records.validate(w, 'policies', row.data);
      return this.store.save(w, row, { ...row.data, status: 'APPROVED' }, true);
    }
    if (action === 'retire' && row.data.status === 'APPROVED') {
      this.independent(w, row);
      return this.store.save(w, row, { ...row.data, status: 'RETIRED' }, true);
    }
    return undefined;
  }
  async request(w: Work, row: OpsRecord<'requests'>, input: z.infer<typeof actionSchema>) {
    if (!this.records.requestVisible(w, row))
      fail('COMPANY_PERMISSION_DENIED', 'الطلب خارج نطاقك.', 403);
    const status = row.data.status;
    if (input.action === 'submit' && status === 'DRAFT') {
      await this.records.activeEmployee(w, row.data.ownerId);
      return this.store.save(w, row, { ...row.data, status: 'SUBMITTED' });
    }
    if (
      ['approve', 'reject'].includes(input.action) &&
      ['SUBMITTED', 'ESCALATED'].includes(status)
    ) {
      this.independent(w, row);
      return this.store.save(
        w,
        row,
        { ...row.data, status: input.action === 'approve' ? 'APPROVED' : 'REJECTED' },
        true,
      );
    }
    if (input.action === 'escalate' && ['SUBMITTED', 'ESCALATED'].includes(status)) {
      if (!input.ownerId || input.ownerId === row.data.ownerId)
        fail('COMPANY_ESCALATION_OWNER_REQUIRED', 'حدد مسؤول تصعيد نشطًا مختلفًا.', 400);
      await this.records.activeEmployee(w, input.ownerId);
      return this.store.save(w, row, { ...row.data, status: 'ESCALATED', ownerId: input.ownerId });
    }
    return undefined;
  }
  async journal(w: Work, row: OpsRecord<'journals'>, input: z.infer<typeof actionSchema>) {
    if (input.action === 'post' && row.data.status === 'DRAFT') {
      this.independent(w, row);
      if (row.data.calculation) {
        const beneficiary = await this.records.activeEmployee(w, row.data.calculation.employeeId);
        if (beneficiary.data.userId === w.actor.userId)
          fail('COMPANY_BENEFICIARY_REVIEW', 'لا يمكنك ترحيل استحقاقك الشخصي.', 403);
      }
      await this.finance.validatePosting(w, row);
      return this.store.save(w, row, { ...row.data, status: 'POSTED' }, true);
    }
    if (
      input.action === 'reverse' &&
      row.data.status === 'POSTED' &&
      row.data.kind !== 'REVERSAL'
    ) {
      await this.finance.notReversed(w, row._id);
      const exists = await this.store
        .collection(w.db)
        .findOne(
          { kind: 'journals', 'data.reversalOf': row._id, 'data.status': { $ne: 'CANCELLED' } },
          { session: w.session },
        );
      if (exists) fail('COMPANY_REVERSAL_EXISTS', 'يوجد قيد عكسي لهذا القيد؛ راجعه بدل التكرار.');
      return this.store.insert(w, 'journals', {
        memo: `عكس: ${row.data.memo}`.slice(0, 200),
        kind: 'REVERSAL',
        date: row.data.date,
        currency: 'SAR',
        status: 'DRAFT',
        reversalOf: row._id,
        sourceKey: `REVERSAL:${row._id}`,
        lines: row.data.lines.map((l) => ({
          accountId: l.accountId,
          debitMinor: l.creditMinor,
          creditMinor: l.debitMinor,
        })),
      });
    }
    return undefined;
  }
}
