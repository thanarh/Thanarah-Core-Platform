import { Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { accrualSchema, type DataMap, type OpsRecord } from './operations.model';
import { journalTotals, periodBounds, rateMinor, totalMinor } from './operations.calculation';
import { fail } from './operations.errors';
import { OperationsRecords } from './operations.records';
import { OperationsStore, type Work } from './operations.store';

@Injectable()
export class OperationsFinance {
  constructor(
    readonly store: OperationsStore,
    readonly records: OperationsRecords,
  ) {}

  async posted(w: Work, period: string) {
    const { from, to } = periodBounds(period);
    return this.store.all(w, 'journals', {
      'data.status': 'POSTED',
      'data.date': { $gte: from, $lte: to },
    });
  }
  async reportIn(w: Work, period: string, extra?: DataMap['journals']) {
    const journals = await this.posted(w, period);
    const accounts = await this.store.all(w, 'accounts');
    const sums = new Map<string, { debit: number[]; credit: number[] }>();
    const all = [...journals.map((j) => j.data), ...(extra ? [extra] : [])];
    for (const journal of all) {
      try {
        journalTotals(journal.lines);
      } catch {
        fail('COMPANY_LEDGER_CORRUPT', 'يوجد قيد مرحّل غير متوازن؛ أوقف الترحيل وراجع السجل.', 503);
      }
      for (const line of journal.lines) {
        const sum = sums.get(line.accountId) ?? { debit: [], credit: [] };
        sum.debit.push(line.debitMinor);
        sum.credit.push(line.creditMinor);
        sums.set(line.accountId, sum);
      }
    }
    const entries = accounts.map((a) => {
      const sum = sums.get(a._id);
      const debitMinor = totalMinor(sum?.debit ?? []);
      const creditMinor = totalMinor(sum?.credit ?? []);
      return {
        _id: a._id,
        data: a.data,
        debitMinor,
        creditMinor,
        balanceMinor: debitMinor - creditMinor,
      };
    });
    if ([...sums.keys()].some((id) => !accounts.some((a) => a._id === id)))
      fail('COMPANY_LEDGER_REFERENCE_MISSING', 'يوجد قيد يشير إلى حساب مفقود.', 503);
    const debitMinor = totalMinor(entries.map((a) => a.debitMinor));
    const creditMinor = totalMinor(entries.map((a) => a.creditMinor));
    const revenueMinor = totalMinor(
      entries.filter((a) => a.data.type === 'REVENUE').map((a) => -a.balanceMinor),
    );
    const expenseMinor = totalMinor(
      entries.filter((a) => a.data.type === 'EXPENSE').map((a) => a.balanceMinor),
    );
    const profitMinor = totalMinor([revenueMinor, -expenseMinor]);
    // Profit allocations debit equity. Their reversals credit the same equity.
    const profitJournals = journals.filter((j) => j.data.kind === 'PROFIT');
    const profitIds = new Set(profitJournals.map((j) => j._id));
    const allocations = all.filter(
      (j) =>
        j.kind === 'PROFIT' ||
        (j.kind === 'REVERSAL' && j.reversalOf && profitIds.has(j.reversalOf)),
    );
    const equityIds = new Set(accounts.filter((a) => a.data.type === 'EQUITY').map((a) => a._id));
    const distributionMinor = totalMinor(
      allocations.flatMap((j) =>
        j.lines.filter((l) => equityIds.has(l.accountId)).map((l) => l.debitMinor - l.creditMinor),
      ),
    );
    return {
      period,
      currency: 'SAR',
      accounts: entries,
      debitMinor,
      creditMinor,
      differenceMinor: debitMinor - creditMinor,
      balanced: debitMinor === creditMinor,
      revenueMinor,
      expenseMinor,
      profitMinor,
      distributionMinor,
      distributableMinor: Math.max(0, profitMinor - distributionMinor),
      profitAllocationValid: distributionMinor <= Math.max(0, profitMinor),
      postedCount: all.length,
    };
  }
  async report(userId: string, period: string) {
    return this.store.read(userId, 'finance.read', (w) => this.reportIn(w, period));
  }
  async notReversed(w: Work, sourceId: string) {
    const reversal = await this.store.collection(w.db).findOne(
      {
        kind: 'journals',
        'data.reversalOf': sourceId,
        'data.status': 'POSTED',
      },
      { session: w.session },
    );
    if (reversal) fail('COMPANY_SOURCE_REVERSED', 'القيد المرجعي عُكس بالفعل.');
  }
  async calculate(w: Work, input: z.infer<typeof accrualSchema>, creating = true) {
    const policy = await this.store.get(w, 'policies', input.policyId);
    if (creating) {
      this.store.require(w.actor, 'finance.manage');
      if (policy.data.type === 'PAYROLL') this.store.require(w.actor, 'hr.read');
      if (policy.data.type === 'COMMISSION') this.store.require(w.actor, 'crm.read');
    }
    const { from, to } = periodBounds(input.period);
    if (
      policy.data.status !== 'APPROVED' ||
      from < policy.data.effectiveFrom ||
      (policy.data.effectiveTo && to > policy.data.effectiveTo)
    ) {
      fail('COMPANY_POLICY_NOT_APPROVED', 'يلزم اعتماد سياسة سارية طوال الفترة قبل الاحتساب.');
    }
    const employee = await this.records.activeEmployee(w, input.employeeId);
    await this.records.validate(w, 'policies', policy.data);
    let basisMinor = 0;
    let contract: OpsRecord<'contracts'> | undefined;
    let sourceKey = `${policy.data.type}:${input.period}:${employee._id}`;
    if (policy.data.type === 'PAYROLL') {
      const contracts = await this.store.all(w, 'contracts', {
        'data.employeeId': employee._id,
        'data.status': 'APPROVED',
        'data.startDate': { $lte: from },
        $or: [{ 'data.endDate': null }, { 'data.endDate': { $gte: to } }],
      });
      if (contracts.length !== 1)
        fail(
          'COMPANY_APPROVED_CONTRACT_REQUIRED',
          'يلزم عقد واحد معتمد يغطي كامل الشهر؛ لا يوجد احتساب جزئي تلقائي.',
        );
      contract = contracts[0];
      basisMinor = contract.data.monthlyMinor;
      if (input.sourceJournalId || input.clientId)
        fail('COMPANY_INPUT_INVALID', 'لا يقبل الراتب مرجع عمولة.', 400);
    } else if (policy.data.type === 'COMMISSION') {
      if (!input.sourceJournalId || !input.clientId)
        fail(
          'COMPANY_COMMISSION_SOURCE_REQUIRED',
          'حدد عميلًا مكتسبًا وقيد إيراد مرحّلًا مرتبطًا به.',
          400,
        );
      const client = await this.store.get(w, 'clients', input.clientId);
      if (client.data.stage !== 'WON' || client.data.ownerId !== employee._id)
        fail(
          'COMPANY_COMMISSION_CLIENT_INVALID',
          'العميل يجب أن يكون مكتسبًا ومسؤول الحساب هو المستفيد.',
        );
      const source = await this.store.get(w, 'journals', input.sourceJournalId);
      if (
        source.data.status !== 'POSTED' ||
        source.data.kind === 'REVERSAL' ||
        source.data.clientId !== client._id ||
        !source.data.date.startsWith(input.period)
      ) {
        fail(
          'COMPANY_COMMISSION_SOURCE_INVALID',
          'المرجع يجب أن يكون قيدًا مرحّلًا لنفس العميل والفترة.',
        );
      }
      await this.notReversed(w, source._id);
      const accounts = await this.store.all(w, 'accounts');
      const revenueIds = new Set(
        accounts.filter((a) => a.data.type === 'REVENUE').map((a) => a._id),
      );
      basisMinor = totalMinor(
        source.data.lines
          .filter((l) => revenueIds.has(l.accountId))
          .map((l) => l.creditMinor - l.debitMinor),
      );
      if (basisMinor <= 0)
        fail('COMPANY_COMMISSION_REVENUE_REQUIRED', 'لا يحتوي القيد على صافي إيراد موجب.');
      sourceKey = `COMMISSION:${source._id}`;
    } else {
      if (input.sourceJournalId || input.clientId)
        fail('COMPANY_INPUT_INVALID', 'توزيع الأرباح يُحسب من دفتر الفترة، لا من مصدر يدوي.', 400);
      const report = await this.reportIn(w, input.period);
      basisMinor = Math.max(0, report.profitMinor);
    }
    const amountMinor = rateMinor(basisMinor, policy.data.rateBps);
    if (amountMinor <= 0 || amountMinor > policy.data.maxAmountMinor)
      fail(
        'COMPANY_POLICY_AMOUNT_LIMIT',
        'المبلغ صفر أو يتجاوز الحد المعتمد؛ عدّل السياسة بمراجعة مستقلة.',
      );
    const calculation: NonNullable<DataMap['journals']['calculation']> = {
      policyId: policy._id,
      policyVersion: policy.version,
      employeeId: employee._id,
      period: input.period,
      basisMinor,
      amountMinor,
      rateBps: policy.data.rateBps,
      ...(contract ? { contractId: contract._id, contractVersion: contract.version } : {}),
      ...(input.sourceJournalId ? { sourceJournalId: input.sourceJournalId } : {}),
      ...(input.clientId ? { clientId: input.clientId } : {}),
    };
    return {
      sourceKey,
      calculation,
      data: {
        memo: `${policy.data.name} — ${employee.data.name} — ${input.period}`,
        kind: policy.data.type,
        date: to,
        currency: 'SAR',
        status: 'DRAFT',
        sourceKey,
        calculation,
        lines: [
          { accountId: policy.data.debitAccountId, debitMinor: amountMinor, creditMinor: 0 },
          { accountId: policy.data.creditAccountId, debitMinor: 0, creditMinor: amountMinor },
        ],
      } satisfies DataMap['journals'],
    };
  }
  async accrue(userId: string, input: z.infer<typeof accrualSchema>) {
    return this.store.command(
      userId,
      input.operationId,
      'accrue',
      input,
      async (w) => {
        const computed = await this.calculate(w, input);
        const existing = await this.store.collection(w.db).findOne(
          {
            kind: 'journals',
            'data.sourceKey': computed.sourceKey,
            'data.status': { $ne: 'CANCELLED' },
          },
          { session: w.session },
        );
        if (existing)
          fail(
            'COMPANY_ACCRUAL_EXISTS',
            'يوجد بالفعل قيد لهذا الاستحقاق؛ راجعه بدل إنشاء قيد مكرر.',
          );
        await this.records.validate(w, 'journals', computed.data);
        const result = await this.store.insert(w, 'journals', computed.data);
        return { result, resource: 'journals', recordId: result._id, toVersion: 1 };
      },
      'finance.manage',
    );
  }
  async validatePosting(w: Work, row: OpsRecord<'journals'>) {
    await this.records.validate(w, 'journals', row.data);
    if (row.data.calculation) {
      const c = row.data.calculation;
      const recalculated = await this.calculate(
        w,
        {
          operationId: row._id,
          policyId: c.policyId,
          employeeId: c.employeeId,
          period: c.period,
          sourceJournalId: c.sourceJournalId,
          clientId: c.clientId,
        },
        false,
      );
      if (JSON.stringify(c) !== JSON.stringify(recalculated.calculation)) {
        fail(
          'COMPANY_CALCULATION_CHANGED',
          'تغيرت السياسة أو العقد أو أساس الاحتساب؛ لا يمكن ترحيل المسودة القديمة.',
        );
      }
    }
    if (row.data.reversalOf) {
      const source = await this.store.get(w, 'journals', row.data.reversalOf);
      if (source.data.status !== 'POSTED')
        fail('COMPANY_REVERSAL_SOURCE_INVALID', 'لا يمكن عكس قيد غير مرحّل.');
      await this.notReversed(w, source._id);
    }
    const projected = await this.reportIn(w, row.data.date.slice(0, 7), row.data);
    if (!projected.balanced || !projected.profitAllocationValid) {
      fail(
        'COMPANY_PROFIT_OVERALLOCATED',
        'سيجعل هذا القيد توزيعات الأرباح تتجاوز الربح الدفتري المتاح؛ راجع التوزيعات أولًا.',
      );
    }
  }
}
