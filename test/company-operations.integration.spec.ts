import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoClient, type Db } from 'mongodb';
import type { ConfigService } from '../src/config/config.service';
import {
  platformUserSchema,
  documentTimestamps,
} from '../src/platform-mongo/platform-mongo.models';
import {
  OfficialPlatformMongoClientFactory,
  PlatformMongoClientManager,
} from '../src/platform-mongo/platform-mongo.client.manager';
import { provisionOperationsIndexes } from '../src/internal-operations/operations.indexes';
import { OperationsStore } from '../src/internal-operations/operations.store';
import { OperationsRecords } from '../src/internal-operations/operations.records';
import { OperationsFinance } from '../src/internal-operations/operations.finance';
import { OperationsActions } from '../src/internal-operations/operations.actions';
import { OperationsService } from '../src/internal-operations/operations.service';
import type { DataMap, OpsRecord, Resource } from '../src/internal-operations/operations.model';

const uri = process.env.COMPANY_TEST_MONGO_URI;
const expectedUri =
  'mongodb://127.0.0.1:45271,127.0.0.1:45272,127.0.0.1:45273/?replicaSet=rs0&retryWrites=true';
if (uri && uri !== expectedUri)
  throw new Error('Company tests require the isolated credential-free loopback replica set.');
const suite = uri ? describe : describe.skip;
const database = `phase65_platform_company_${randomUUID().replaceAll('-', '')}`;
const a = randomUUID(),
  b = randomUUID(),
  worker = randomUUID(),
  tech = randomUUID();
const manager = new PlatformMongoClientManager(
  { platformMongoUri: expectedUri, platformMongoDatabase: database } as ConfigService,
  new OfficialPlatformMongoClientFactory(),
);
const store = new OperationsStore(manager);
const records = new OperationsRecords(store);
const finance = new OperationsFinance(store, records);
const actions = new OperationsActions(store, records, finance);
const service = new OperationsService(store, records, finance);
let client: MongoClient, db: Db;
const date = '2026-11-30';

async function create<K extends Resource>(kind: K, data: DataMap[K], actor = a) {
  return (await records.write(actor, kind, { operationId: randomUUID(), data })) as OpsRecord<K>;
}
async function action<K extends Resource>(
  row: OpsRecord<K>,
  name: 'approve' | 'post' | 'reverse' | 'cancel' | 'submit' | 'escalate' | 'retire',
  actor = b,
  ownerId?: string,
) {
  return (await actions.apply(actor, row.kind, row._id, {
    operationId: randomUUID(),
    version: row.version,
    action: name,
    reason: 'Synthetic independent review',
    ...(ownerId ? { ownerId } : {}),
  })) as OpsRecord<K>;
}
async function setupEmployee(userId = worker, roles = ['EMPLOYEE']) {
  let unit = await db
    .collection('company_records')
    .findOne({ kind: 'units', 'data.unitType': 'COMPANY' });
  if (!unit)
    unit = (await create('units', {
      name: 'Synthetic company',
      unitType: 'COMPANY',
      parentId: null,
      status: 'ACTIVE',
    })) as never;
  return create('employees', {
    name: 'Synthetic employee',
    userId,
    unitId: String(unit!._id),
    jobTitle: 'Test',
    roleIds: roles,
    status: 'ACTIVE',
  });
}
async function chart() {
  const account = (code: string, type: DataMap['accounts']['type']) =>
    create('accounts', {
      code,
      name: `Synthetic ${code}`,
      type,
      currency: 'SAR',
      status: 'ACTIVE',
    });
  return {
    cash: await account('100', 'ASSET'),
    bank: await account('110', 'ASSET'),
    payable: await account('200', 'LIABILITY'),
    equity: await account('300', 'EQUITY'),
    revenue: await account('400', 'REVENUE'),
    expense: await account('500', 'EXPENSE'),
  };
}
async function journal(debit: string, credit: string, amount: number, clientId?: string) {
  return create('journals', {
    memo: 'Synthetic journal',
    kind: 'GENERAL',
    date,
    currency: 'SAR',
    status: 'DRAFT',
    lines: [
      { accountId: debit, debitMinor: amount, creditMinor: 0 },
      { accountId: credit, debitMinor: 0, creditMinor: amount },
    ],
    ...(clientId ? { clientId } : {}),
  });
}
async function policy(
  type: DataMap['policies']['type'],
  debit: string,
  credit: string,
  rateBps = 10000,
) {
  return create('policies', {
    name: 'Synthetic policy',
    type,
    currency: 'SAR',
    rateBps,
    maxAmountMinor: 1_000_000,
    debitAccountId: debit,
    creditAccountId: credit,
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    rounding: 'HALF_UP',
    status: 'DRAFT',
  });
}
suite('Internal company operations on isolated MongoDB', () => {
  beforeAll(async () => {
    client = new MongoClient(expectedUri, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    db = client.db(database);
    await provisionOperationsIndexes(db);
  }, 30000);
  beforeEach(async () => {
    for (const name of [
      'company_records',
      'company_audit',
      'company_commands',
      'company_control',
      'platform_users',
      'platform_roles',
      'platform_user_roles',
    ])
      await db.collection(name).deleteMany({});
    await db.collection('platform_users').insertMany(
      [a, b, worker, tech].map((_id) =>
        platformUserSchema.parse({
          _id,
          ...documentTimestamps(),
          schemaVersion: 1,
          status: 'ACTIVE',
          email: `${_id}@example.test`,
          fullName: 'Synthetic identity',
          passwordHash: 'Synthetic-unused-hash',
          tokenVersion: 0,
          failedLoginAttempts: 0,
          lockedUntil: null,
        }),
      ) as never,
    );
    const role = randomUUID();
    await db.collection('platform_roles').insertOne({
      _id: role,
      ...documentTimestamps(),
      schemaVersion: 1,
      code: 'SUPER_ADMIN',
    } as never);
    await db
      .collection('platform_user_roles')
      .insertMany([a, b].map((userId) => ({ _id: randomUUID(), userId, roleId: role })) as never);
  });
  afterAll(async () => {
    if (db && /^phase65_platform_company_[a-f0-9]{32}$/.test(db.databaseName))
      await db.dropDatabase();
    await manager.onApplicationShutdown();
    await client?.close();
  });
  it('fails closed for clinic/unlinked identities and hides finance/HR from CTO', async () => {
    await expect(service.session(worker)).rejects.toMatchObject({ code: 'COMPANY_ACCESS_DENIED' });
    await setupEmployee(tech, ['CTO']);
    const context = await service.session(tech);
    expect(context.permissions).toContain('dashboard.cto');
    for (const user of await db.collection('platform_users').find().toArray()) {
      expect(platformUserSchema.safeParse(user).success).toBe(true);
    }
    expect(context.permissions).not.toContain('finance.read');
    await expect(finance.report(tech, '2026-11')).rejects.toMatchObject({ status: 403 });
    await expect(
      records.list(tech, 'contracts', { page: 1, limit: 20, q: '' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(await service.dashboard(tech, 'cto')).not.toHaveProperty('finance');
  });
  it('lets a financial controller post payroll without acquiring creation or HR-write powers', async () => {
    const beneficiary = await setupEmployee();
    await setupEmployee(tech, ['FINANCIAL_CONTROLLER']);
    const accounts = await chart();
    const rule = await action(
      await policy('PAYROLL', accounts.expense._id, accounts.payable._id),
      'approve',
    );
    const contract = await create('contracts', {
      employeeId: beneficiary._id,
      title: 'Synthetic contract',
      startDate: '2026-01-01',
      endDate: null,
      monthlyMinor: 10000,
      currency: 'SAR',
      status: 'DRAFT',
    });
    await action(contract, 'approve');
    const journal = await finance.accrue(a, {
      operationId: randomUUID(),
      policyId: rule._id,
      employeeId: beneficiary._id,
      period: '2026-11',
    });
    const context = await service.session(tech);
    expect(context.permissions).not.toContain('finance.manage');
    expect((await action(journal, 'post', tech)).data.status).toBe('POSTED');
  });
  it('refuses corrupted creator metadata and approvals without independent-review evidence', async () => {
    const accounts = await chart();
    const draft = await journal(accounts.cash._id, accounts.revenue._id, 100);
    await db
      .collection('company_records')
      .updateOne({ _id: draft._id } as never, { $unset: { createdBy: '' } });
    await expect(action(draft, 'post')).rejects.toMatchObject({
      code: 'COMPANY_DATA_INVALID',
      status: 503,
    });
    await db
      .collection('company_records')
      .updateOne({ _id: draft._id } as never, { $set: { createdBy: a, 'data.status': 'POSTED' } });
    await expect(finance.report(a, '2026-11')).rejects.toMatchObject({
      code: 'COMPANY_DATA_INVALID',
      status: 503,
    });
  });
  it('calculates totals over the complete ledger rather than a paginated slice', async () => {
    const accounts = await chart();
    await db.collection('company_records').insertMany(
      Array.from({ length: 130 }, (_, index) => ({
        _id: randomUUID(),
        kind: 'journals',
        version: 2,
        createdBy: a,
        approvedBy: b,
        approvedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        data: {
          memo: `Synthetic page ${index}`,
          date,
          kind: 'GENERAL',
          status: 'POSTED',
          currency: 'SAR',
          lines: [
            { accountId: accounts.cash._id, debitMinor: 1, creditMinor: 0 },
            { accountId: accounts.revenue._id, debitMinor: 0, creditMinor: 1 },
          ],
        },
      })) as never,
    );
    const list = await records.list(a, 'journals', { page: 1, limit: 20, q: '' });
    expect(list.total).toBe(130);
    expect(list.items).toHaveLength(20);
    expect(await finance.report(a, '2026-11')).toMatchObject({
      postedCount: 130,
      debitMinor: 130,
      creditMinor: 130,
      profitMinor: 130,
    });
  });
  it('requires access permission to link accounts or grant roles and prevents self changes', async () => {
    await setupEmployee(tech, ['GENERAL_DIRECTOR']);
    const employee = await setupEmployee();
    await expect(
      records.write(
        tech,
        'employees',
        {
          operationId: randomUUID(),
          version: employee.version,
          data: { ...employee.data, roleIds: ['CEO'] },
        },
        employee._id,
      ),
    ).rejects.toMatchObject({ status: 403 });
    const own = await records.list(tech, 'employees', { page: 1, limit: 50, q: '' });
    expect(own.total).toBe(2);
    const user = await setupEmployee(a, ['CEO']);
    await expect(
      records.write(
        a,
        'employees',
        {
          operationId: randomUUID(),
          version: user.version,
          data: { ...user.data, roleIds: ['HR'] },
        },
        user._id,
      ),
    ).rejects.toMatchObject({ code: 'COMPANY_SELF_ACCESS_CHANGE' });
  });
  it('validates organization hierarchy and linked references', async () => {
    const employee = await setupEmployee();
    await expect(
      create('units', {
        name: 'Invalid',
        unitType: 'SECTION',
        parentId: employee.data.unitId,
        status: 'ACTIVE',
      }),
    ).rejects.toMatchObject({ code: 'COMPANY_HIERARCHY_INVALID' });
    const company = await store.read(a, 'organization.read', (w) =>
      store.get(w, 'units', employee.data.unitId),
    );
    await expect(
      records.write(
        a,
        'units',
        {
          operationId: randomUUID(),
          version: company.version,
          data: { ...company.data, status: 'ARCHIVED' },
        },
        company._id,
      ),
    ).rejects.toMatchObject({ code: 'COMPANY_UNIT_IN_USE' });
  });
  it('makes mutation and audit atomic even when audit persistence fails', async () => {
    await db.command({
      collMod: 'company_audit',
      validator: { actorUserId: 'deliberately-block-all' },
      validationLevel: 'strict',
    });
    try {
      await expect(
        create('units', {
          name: 'Rollback',
          unitType: 'COMPANY',
          parentId: null,
          status: 'ACTIVE',
        }),
      ).rejects.toBeTruthy();
      expect(await db.collection('company_records').countDocuments()).toBe(0);
      expect(await db.collection('company_commands').countDocuments()).toBe(0);
    } finally {
      await db.command({ collMod: 'company_audit', validator: {}, validationLevel: 'strict' });
    }
  });
  it('retries one operation exactly once and rejects conflicting or revoked retries', async () => {
    const input = {
      operationId: randomUUID(),
      data: { name: 'Synthetic company', unitType: 'COMPANY', parentId: null, status: 'ACTIVE' },
    };
    const first = await records.write(a, 'units', input);
    expect((await records.write(a, 'units', input))._id).toBe(first._id);
    expect(await db.collection('company_audit').countDocuments()).toBe(1);
    await expect(
      records.write(a, 'units', { ...input, data: { ...input.data, name: 'Changed' } }),
    ).rejects.toMatchObject({ code: 'COMPANY_IDEMPOTENCY_CONFLICT' });
    await db
      .collection('platform_users')
      .updateOne({ _id: a } as never, { $set: { status: 'DISABLED' } });
    await expect(records.write(a, 'units', input)).rejects.toMatchObject({ status: 403 });
  });
  it('serializes duplicate account creation under different operation references', async () => {
    const data: DataMap['accounts'] = {
      code: 'DUP',
      name: 'Synthetic',
      type: 'ASSET',
      currency: 'SAR',
      status: 'ACTIVE',
    };
    const results = await Promise.allSettled([create('accounts', data), create('accounts', data)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.collection('company_records').countDocuments({ kind: 'accounts' })).toBe(1);
    expect(await db.collection('company_audit').countDocuments()).toBe(1);
  });
  it('enforces versioned edits and makes approvals independent and immutable', async () => {
    const accounts = await chart();
    const draft = await policy('PAYROLL', accounts.expense._id, accounts.payable._id);
    await expect(action(draft, 'approve', a)).rejects.toMatchObject({
      code: 'COMPANY_INDEPENDENT_REVIEW_REQUIRED',
    });
    await expect(
      records.write(
        a,
        'policies',
        { operationId: randomUUID(), version: 99, data: draft.data },
        draft._id,
      ),
    ).rejects.toMatchObject({ code: 'COMPANY_VERSION_CONFLICT' });
    const approved = await action(draft, 'approve');
    await expect(
      records.write(
        a,
        'policies',
        {
          operationId: randomUUID(),
          version: approved.version,
          data: { ...approved.data, status: 'DRAFT' },
        },
        approved._id,
      ),
    ).rejects.toMatchObject({ code: 'COMPANY_DRAFT_REQUIRED' });
  });
  it('blocks unbalanced and forged calculated entries without leaving audit or data', async () => {
    const accounts = await chart();
    const original = await journal(accounts.cash._id, accounts.revenue._id, 10000);
    await expect(
      create('journals', {
        ...original.data,
        lines: [
          { accountId: accounts.cash._id, debitMinor: 100, creditMinor: 0 },
          { accountId: accounts.revenue._id, debitMinor: 0, creditMinor: 99 },
        ],
      }),
    ).rejects.toMatchObject({ code: 'COMPANY_JOURNAL_UNBALANCED' });
    await expect(
      create('journals', { ...original.data, kind: 'PAYROLL', sourceKey: 'forged' }),
    ).rejects.toMatchObject({ code: 'COMPANY_GENERATED_JOURNAL' });
    await expect(action(original, 'post', a)).rejects.toMatchObject({
      code: 'COMPANY_INDEPENDENT_REVIEW_REQUIRED',
    });
  });
  it('reconciles posted revenue and expenses exactly while excluding drafts', async () => {
    const accounts = await chart();
    await action(await journal(accounts.cash._id, accounts.revenue._id, 25005), 'post');
    await action(await journal(accounts.expense._id, accounts.payable._id, 10004), 'post');
    await journal(accounts.cash._id, accounts.revenue._id, 900000);
    const report = await finance.report(a, '2026-11');
    expect(report).toMatchObject({
      debitMinor: 35009,
      creditMinor: 35009,
      differenceMinor: 0,
      balanced: true,
      revenueMinor: 25005,
      expenseMinor: 10004,
      profitMinor: 15001,
      postedCount: 2,
    });
  });
  it('requires approved full-month payroll policies/contracts and prevents duplicate accruals', async () => {
    const employee = await setupEmployee();
    const accounts = await chart();
    const draft = await policy('PAYROLL', accounts.expense._id, accounts.payable._id);
    const input = {
      operationId: randomUUID(),
      policyId: draft._id,
      employeeId: employee._id,
      period: '2026-11',
    };
    await expect(finance.accrue(a, input)).rejects.toMatchObject({
      code: 'COMPANY_POLICY_NOT_APPROVED',
    });
    await action(draft, 'approve');
    await expect(finance.accrue(a, input)).rejects.toMatchObject({
      code: 'COMPANY_APPROVED_CONTRACT_REQUIRED',
    });
    const contract = await create('contracts', {
      employeeId: employee._id,
      title: 'Synthetic full month',
      startDate: '2026-01-01',
      endDate: null,
      monthlyMinor: 123405,
      currency: 'SAR',
      status: 'DRAFT',
    });
    await action(contract, 'approve');
    const accrued = await finance.accrue(a, input);
    expect(accrued.data.calculation).toMatchObject({
      amountMinor: 123405,
      basisMinor: 123405,
      contractId: contract._id,
    });
    await action(accrued, 'post');
    await expect(finance.accrue(a, { ...input, operationId: randomUUID() })).rejects.toMatchObject({
      code: 'COMPANY_ACCRUAL_EXISTS',
    });
    expect((await finance.report(a, '2026-11')).expenseMinor).toBe(123405);
  });
  it('does not allow a beneficiary to approve their own contract', async () => {
    const employee = await setupEmployee(b, ['HR']);
    const contract = await create('contracts', {
      employeeId: employee._id,
      title: 'Synthetic',
      startDate: '2026-01-01',
      endDate: null,
      monthlyMinor: 10000,
      currency: 'SAR',
      status: 'DRAFT',
    });
    await expect(action(contract, 'approve', b)).rejects.toMatchObject({
      code: 'COMPANY_BENEFICIARY_REVIEW',
    });
  });
  it('calculates commissions from linked recognized revenue with exact approved rounding', async () => {
    const employee = await setupEmployee();
    const accounts = await chart();
    const clientRecord = await create('clients', {
      name: 'Synthetic client',
      contact: '',
      ownerId: employee._id,
      stage: 'WON',
    });
    const revenue = await action(
      await journal(accounts.cash._id, accounts.revenue._id, 10005, clientRecord._id),
      'post',
    );
    const rule = await action(
      await policy('COMMISSION', accounts.expense._id, accounts.payable._id, 1000),
      'approve',
    );
    const input = {
      operationId: randomUUID(),
      policyId: rule._id,
      employeeId: employee._id,
      period: '2026-11',
      clientId: clientRecord._id,
      sourceJournalId: revenue._id,
    };
    const accrued = await finance.accrue(a, input);
    expect(accrued.data.calculation).toMatchObject({ basisMinor: 10005, amountMinor: 1001 });
    await action(accrued, 'post');
    expect((await finance.report(a, '2026-11')).profitMinor).toBe(9004);
    await expect(finance.accrue(a, { ...input, operationId: randomUUID() })).rejects.toMatchObject({
      code: 'COMPANY_ACCRUAL_EXISTS',
    });
  });
  it('rejects stale calculations and permits audited cancellation and recalculation', async () => {
    const employee = await setupEmployee();
    const accounts = await chart();
    await action(await journal(accounts.cash._id, accounts.revenue._id, 10000), 'post');
    const rule = await action(
      await policy('PROFIT', accounts.equity._id, accounts.payable._id, 1000),
      'approve',
    );
    const input = {
      operationId: randomUUID(),
      policyId: rule._id,
      employeeId: employee._id,
      period: '2026-11',
    };
    const accrued = await finance.accrue(a, input);
    await action(await journal(accounts.expense._id, accounts.payable._id, 1000), 'post');
    await expect(action(accrued, 'post')).rejects.toMatchObject({
      code: 'COMPANY_CALCULATION_CHANGED',
    });
    await action(accrued, 'cancel', a);
    expect(
      (await finance.accrue(a, { ...input, operationId: randomUUID() })).data.calculation
        ?.amountMinor,
    ).toBe(900);
  });
  it('caps total profit distributions across beneficiaries and independent policies', async () => {
    const employee = await setupEmployee();
    const second = await setupEmployee(tech);
    const accounts = await chart();
    await action(await journal(accounts.cash._id, accounts.revenue._id, 10000), 'post');
    const rule = await action(
      await policy('PROFIT', accounts.equity._id, accounts.payable._id, 7000),
      'approve',
    );
    const first = await finance.accrue(a, {
      operationId: randomUUID(),
      policyId: rule._id,
      employeeId: employee._id,
      period: '2026-11',
    });
    const next = await finance.accrue(a, {
      operationId: randomUUID(),
      policyId: rule._id,
      employeeId: second._id,
      period: '2026-11',
    });
    await action(first, 'post');
    await expect(action(next, 'post')).rejects.toMatchObject({
      code: 'COMPANY_PROFIT_OVERALLOCATED',
    });
    expect((await finance.report(a, '2026-11')).distributionMinor).toBe(7000);
  });
  it('posts reversals instead of editing history, prevents double reversal and reconciles to zero', async () => {
    const accounts = await chart();
    const source = await action(
      await journal(accounts.cash._id, accounts.revenue._id, 10005),
      'post',
    );
    const reversed = await action(source, 'reverse', a);
    await action(reversed, 'post');
    const report = await finance.report(a, '2026-11');
    expect(report).toMatchObject({
      revenueMinor: 0,
      profitMinor: 0,
      differenceMinor: 0,
      postedCount: 2,
    });
    expect(
      (await store.read(a, 'finance.read', (w) => store.get(w, 'journals', source._id))).data
        .status,
    ).toBe('POSTED');
    await expect(action(source, 'reverse', a)).rejects.toMatchObject({
      code: 'COMPANY_SOURCE_REVERSED',
    });
  });
  it('keeps employee requests scoped, escalates with a reason, and refuses self approval', async () => {
    const employee = await setupEmployee();
    const technical = await setupEmployee(tech, ['CTO']);
    const request = await create('requests', {
      title: 'Synthetic HR request',
      description: '',
      category: 'HR',
      ownerId: employee._id,
      dueDate: date,
      status: 'DRAFT',
    });
    expect((await records.list(tech, 'requests', { page: 1, limit: 50, q: '' })).total).toBe(0);
    const submitted = await action(request, 'submit', a);
    await expect(action(submitted, 'approve', a)).rejects.toMatchObject({
      code: 'COMPANY_INDEPENDENT_REVIEW_REQUIRED',
    });
    const escalated = await action(submitted, 'escalate', a, technical._id);
    expect((await records.list(tech, 'requests', { page: 1, limit: 50, q: '' })).total).toBe(1);
    const approved = await action(escalated, 'approve');
    expect(approved.data.status).toBe('APPROVED');
    expect(await db.collection('company_audit').countDocuments({ resource: 'requests' })).toBe(4);
  });
});
