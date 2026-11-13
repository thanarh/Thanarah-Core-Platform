import type { Db, IndexDescription } from 'mongodb';
export const JOURNEY_INDEXES: Record<string, IndexDescription[]> = {
  customer_accounts: [{ key: { userId: 1 }, name: 'ux_customer_user', unique: true }],
  customer_orders: [
    {
      key: { customerId: 1 },
      name: 'ux_customer_open_order',
      unique: true,
      partialFilterExpression: { open: true },
    },
    { key: { managerId: 1, updatedAt: -1 }, name: 'ix_customer_order_manager' },
    { key: { customerId: 1, createdAt: -1 }, name: 'ix_customer_order_owner' },
    {
      key: { subscriptionId: 1 },
      name: 'ux_customer_order_subscription',
      unique: true,
      partialFilterExpression: { subscriptionId: { $type: 'string' } },
    },
  ],
  customer_documents: [
    {
      key: { orderId: 1, key: 1 },
      name: 'ux_customer_current_document',
      unique: true,
      partialFilterExpression: { superseded: false },
    },
  ],
  customer_invoices: [
    {
      key: { orderId: 1 },
      name: 'ux_customer_order_invoice',
      unique: true,
      partialFilterExpression: { status: { $in: ['DRAFT', 'ISSUED', 'PAID'] } },
    },
    {
      key: { number: 1 },
      name: 'ux_customer_invoice_number',
      unique: true,
      partialFilterExpression: { number: { $type: 'string' } },
    },
    {
      key: { transferId: 1 },
      name: 'ux_customer_invoice_transfer',
      unique: true,
      partialFilterExpression: { transferId: { $type: 'string' } },
    },
  ],
  customer_reviews: [{ key: { orderId: 1 }, name: 'ux_customer_review_order', unique: true }],
  customer_events: [{ key: { orderId: 1, at: 1 }, name: 'ix_customer_event_order' }],
};
export async function provisionJourneyIndexes(db: Db): Promise<void> {
  for (const [name, indexes] of Object.entries(JOURNEY_INDEXES))
    await db.collection(name).createIndexes(indexes);
  for (const name of ['customer_settings', 'customer_commands', 'customer_counters'])
    if (!(await db.listCollections({ name }, { nameOnly: true }).hasNext()))
      await db.createCollection(name);
}
