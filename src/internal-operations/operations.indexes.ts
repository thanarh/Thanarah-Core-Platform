import type { Db, IndexDescription } from 'mongodb';
export const OPERATIONS_INDEXES: Record<string, IndexDescription[]> = {
  company_records: [
    { key: { kind: 1, updatedAt: -1, _id: 1 }, name: 'ix_company_kind_updated' },
    {
      key: { 'data.userId': 1 },
      name: 'ux_company_employee_user',
      unique: true,
      partialFilterExpression: { kind: 'employees', 'data.userId': { $type: 'string' } },
    },
    {
      key: { 'data.code': 1 },
      name: 'ux_company_account_code',
      unique: true,
      partialFilterExpression: { kind: 'accounts' },
    },
    {
      key: { 'data.sourceKey': 1 },
      name: 'ux_company_journal_source',
      unique: true,
      partialFilterExpression: {
        kind: 'journals',
        'data.sourceKey': { $type: 'string' },
        'data.status': { $in: ['DRAFT', 'POSTED'] },
      },
    },
    { key: { kind: 1, 'data.status': 1, 'data.date': 1 }, name: 'ix_company_posted_date' },
  ],
  company_audit: [{ key: { at: -1, _id: 1 }, name: 'ix_company_audit_time' }],
  company_commands: [{ key: { actorUserId: 1, createdAt: -1 }, name: 'ix_company_commands_actor' }],
};
export async function provisionOperationsIndexes(db: Db): Promise<void> {
  for (const [name, indexes] of Object.entries(OPERATIONS_INDEXES)) {
    await db.collection(name).createIndexes(indexes);
  }
  // First writer must not create a collection inside a transaction.
  for (const name of ['company_records', 'company_audit', 'company_commands', 'company_control']) {
    if (!(await db.listCollections({ name }, { nameOnly: true }).hasNext())) {
      await db.createCollection(name);
    }
  }
}
