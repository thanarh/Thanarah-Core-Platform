import { randomUUID, createHash } from 'node:crypto';
import { MongoClient, Binary, type Db } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ConfigService } from '../src/config/config.service';
import { PlatformMongoClientManager, OfficialPlatformMongoClientFactory } from '../src/platform-mongo/platform-mongo.client.manager';
import { provisionPlatformMongoIndexes } from '../src/platform-mongo/platform-mongo.indexes';
import { initializeMongoReferenceData } from '../src/platform-mongo/platform-mongo.initialize';
import {
  documentTimestamps, platformUserSchema, platformPlanSchema, stableAssignmentId,
  tenantSchema, tenantMembershipSchema, tenantRoleSchema, tenantMembershipRoleSchema,
  subscriptionSchema,
} from '../src/platform-mongo/platform-mongo.models';
import { provisionOperationsIndexes } from '../src/internal-operations/operations.indexes';
import { OperationsStore } from '../src/internal-operations/operations.store';
import { OperationsRecords } from '../src/internal-operations/operations.records';
import { PasswordHasherService } from '../src/auth/security/password-hasher.service';
import { PasswordPolicyService } from '../src/auth/security/password-policy.service';
import type { TenantMongoClientManager } from '../src/tenant/tenant-mongo-client.manager';
import { provisionJourneyIndexes } from '../src/customer-journey/journey.indexes';
import { JourneyStore } from '../src/customer-journey/journey.store';
import { JourneyAccounts } from '../src/customer-journey/journey.accounts';
import { JourneyAccess } from '../src/customer-journey/journey.access';
import { JourneyOrders } from '../src/customer-journey/journey.orders';
import { JourneyDocuments } from '../src/customer-journey/journey.documents';
import { JourneyAdmin } from '../src/customer-journey/journey.admin';
import { JourneyBilling } from '../src/customer-journey/journey.billing';
import { defaultCatalog, type Account, type Order } from '../src/customer-journey/journey.model';

const expected = 'mongodb://127.0.0.1:45271,127.0.0.1:45272,127.0.0.1:45273/?replicaSet=rs0&retryWrites=true';
if (process.env.CUSTOMER_TEST_MONGO_URI && process.env.CUSTOMER_TEST_MONGO_URI !== expected)
  throw new Error('Customer tests require isolated credential-free loopback MongoDB.');
const suite = process.env.CUSTOMER_TEST_MONGO_URI ? describe : describe.skip;
const database = `phase65_platform_cj_${randomUUID().replaceAll('-', '')}`;
const manager = new PlatformMongoClientManager({
  platformMongoUri: expected, platformMongoDatabase: database,
} as ConfigService, new OfficialPlatformMongoClientFactory());
const company = new OperationsStore(manager), records = new OperationsRecords(company);
const store = new JourneyStore(manager, company);
const accounts = new JourneyAccounts(store, new PasswordHasherService(), new PasswordPolicyService());
// Real isolated replica set for all business writes. Only the remote tenant ping
// is replaced by a harmless test double; browser fixture never forges verification.
const access = new JourneyAccess({
  getDatabase: async () => ({ command: async () => ({ ok: 1 }) }),
} as unknown as TenantMongoClientManager);
const orders = new JourneyOrders(store, access), documents = new JourneyDocuments(store);
const admin = new JourneyAdmin(store, orders, access), billing = new JourneyBilling(store);
const root = randomUUID(), reviewer = randomUUID(), tech = randomUUID(), accountManager = randomUUID();
let db: Db, client: MongoClient, planId: string, managerId: string;
const op = () => ({ operationId: randomUUID() });
const password = 'Synthetic-Customer-Only!2026';
const profile = {
  legalName: 'Synthetic Clinic', displayName: 'Synthetic Clinic Display',
  registrationNumber: 'SYNTHETIC-ONLY', city: 'Test city', address: 'Synthetic test address',
  contactName: 'Synthetic client', phoneE164: '+966500000001',
};
async function customer(email = `${randomUUID()}@example.test`) {
  await accounts.register({ ...op(), fullName: 'Synthetic customer', email, password });
  const account = await db.collection('customer_accounts').findOne({ email });
  return (await accounts.profile(String(account!.userId), { ...op(), version: 1, profile })) as Account;
}
async function publish() {
  const data = defaultCatalog().draft;
  data.ordersOpen = true;
  data.termsText = 'Synthetic test-only terms, not a real commercial or legal policy.';
  data.documents = [{ key: 'license', label: 'Test license', required: true }];
  data.packages = data.packages.map(p => ({ ...p, planId, priceMinor: '10005', features: ['Synthetic only'] }));
  data.seller = { name: 'Synthetic seller', address: 'Test-only address', taxNumber: 'TEST', prefix: 'TEST' };
  const current = await admin.catalog(root);
  const saved = await admin.saveCatalog(root, { ...op(), version: current.version, data });
  return admin.publish(reviewer, { ...op(), version: saved.version, reason: 'Synthetic publication' });
}
async function draft() {
  await publish();
  const account = await customer();
  const order = await orders.create(account.userId, { ...op(), packageCode: 'Lite' });
  return { account, order };
}
const fileBytes = Buffer.from('%PDF-1.4\nSynthetic document, not real customer data.\n%%EOF');
const file = { bytes: fileBytes, fileName: 'synthetic.pdf', mimeType: 'application/pdf' as const,
  sha256: createHash('sha256').update(fileBytes).digest('hex') };
async function submitted() {
  const { account, order } = await draft();
  const doc = await documents.upload(account.userId, order._id, file, {
    ...op(), key: 'license', version: order.version,
  });
  const assigned = await admin.action(root, order._id, {
    ...op(), version: order.version + 1, action: 'assign', managerId, reason: 'Synthetic assignment',
  });
  const current = await orders.action(account.userId, order._id, {
    ...op(), version: assigned.version, action: 'submit', acceptedTermsVersion: order.termsVersion,
  });
  return { account, order: current, doc };
}
async function approved() {
  const data = await submitted();
  await documents.review(reviewer, data.doc._id, { ...op(), version: data.doc.version,
    decision: 'APPROVED', reason: 'Synthetic document review' });
  const order = await admin.action(reviewer, data.order._id, {
    ...op(), version: data.order.version, action: 'approve', reason: 'Synthetic approval',
  });
  return { ...data, order };
}
async function prepared(account: Account, order: Order) {
  // Explicit synthetic verification fixture for testing guards AFTER the missing
  // provider gate. There is no application endpoint that grants this state.
  await db.collection('customer_accounts').updateOne({ _id: account._id } as never, { $set: {
    phoneVerification: { status: 'VERIFIED', phoneE164: profile.phoneE164, verifiedAt: new Date() },
  } });
  const tenantId = randomUUID(), membershipId = randomUUID(), roleId = randomUUID(), subscriptionId = randomUUID();
  const common = { ...documentTimestamps(), schemaVersion: 1 };
  await db.collection('tenants').insertOne(tenantSchema.parse({
    _id: tenantId, ...common, slug: `synthetic-${randomUUID()}`, legalName: profile.legalName,
    displayName: profile.displayName, status: 'ACTIVE', statusChangedAt: new Date(),
    suspendedAt: null, deactivatedAt: null,
  }) as never);
  await db.collection('tenant_memberships').insertOne(tenantMembershipSchema.parse({
    _id: membershipId, ...common, tenantId, platformUserId: account.userId, status: 'ACTIVE',
    statusChangedAt: new Date(), activatedAt: new Date(), suspendedAt: null, removedAt: null,
  }) as never);
  await db.collection('tenant_roles').insertOne(tenantRoleSchema.parse({
    _id: roleId, ...common, tenantId, code: 'OWNER', name: 'Synthetic owner',
    description: null, isSystemRole: true,
  }) as never);
  await db.collection('tenant_membership_roles').insertOne(tenantMembershipRoleSchema.parse({
    _id: stableAssignmentId(membershipId, roleId), tenantId, membershipId,
    tenantRoleId: roleId, assignedAt: new Date(),
  }) as never);
  await db.collection('subscriptions').insertOne(subscriptionSchema.parse({
    _id: subscriptionId, ...common, tenantId, planId, status: 'ACTIVE',
    startsAt: new Date(Date.now() - 60000), endsAt: null, cancelledAt: null,
  }) as never);
  await db.collection('tenant_storage_targets').insertOne({
    _id: randomUUID(), tenantId, provider: 'MONGODB', connectionReference: 'primary',
    databaseName: 'phase65_tenant_synthetic', status: 'ACTIVE', isPrimary: true,
    createdAt: new Date(), updatedAt: new Date(),
  } as never);
  return { tenantId, subscriptionId, membershipId };
}
async function active() {
  const data = await approved();
  const links = await prepared(data.account, data.order);
  const order = await admin.action(root, data.order._id, { ...op(), version: data.order.version,
    action: 'activate', reason: 'Synthetic activation after guard fixture',
    tenantId: links.tenantId, subscriptionId: links.subscriptionId });
  return { ...data, order, links };
}
suite('Customer journey isolated business acceptance', () => {
  beforeAll(async () => {
    client = new MongoClient(expected); await client.connect(); db = client.db(database);
    await provisionPlatformMongoIndexes(db); await provisionOperationsIndexes(db); await provisionJourneyIndexes(db);
    const session = client.startSession();
    try { await session.withTransaction(() => initializeMongoReferenceData(db, session)); }
    finally { await session.endSession(); }
    const role = await db.collection('platform_roles').findOne({ code: 'SUPER_ADMIN' });
    for (const userId of [root, reviewer, tech, accountManager]) {
      await db.collection('platform_users').insertOne(platformUserSchema.parse({
        _id: userId, ...documentTimestamps(), schemaVersion: 1, email: `${userId}@example.test`,
        fullName: 'Synthetic operator', passwordHash: 'synthetic-test-only',
        status: 'ACTIVE', tokenVersion: 0, failedLoginAttempts: 0, lockedUntil: null,
      }) as never);
      if (userId === root || userId === reviewer) await db.collection('platform_user_roles').insertOne({
        _id: stableAssignmentId(userId, String(role!._id)), userId, roleId: role!._id,
      } as never);
    }
    const unit = await records.write(root, 'units', { ...op(), data: {
      name: 'Synthetic company', unitType: 'COMPANY', parentId: null, status: 'ACTIVE',
    } });
    for (const [userId, roleId] of [[tech, 'CTO'], [accountManager, 'ACCOUNT_MANAGER']]) {
      const employee = await records.write(root, 'employees', { ...op(), data: {
        name: 'Synthetic employee', userId, unitId: unit._id, jobTitle: roleId,
        roleIds: [roleId], status: 'ACTIVE',
      } });
      if (userId === accountManager) managerId = employee._id;
    }
    const plan = platformPlanSchema.parse({
      _id: randomUUID(), ...documentTimestamps(), schemaVersion: 1, key: 'synthetic-plan',
      name: 'Synthetic plan', description: null, status: 'ACTIVE', statusChangedAt: new Date(),
    });
    await db.collection('platform_plans').insertOne(plan as never); planId = plan._id;
  }, 30000);
  beforeEach(async () => {
    for (const name of ['customer_accounts', 'customer_orders', 'customer_settings', 'customer_documents',
      'customer_invoices', 'customer_reviews', 'customer_events', 'customer_commands', 'customer_counters',
      'subscriptions', 'subscription_transfers', 'tenants', 'tenant_memberships', 'tenant_roles',
      'tenant_membership_roles', 'tenant_storage_targets'])
      await db.collection(name).deleteMany({});
  });
  afterAll(async () => {
    await manager.onApplicationShutdown();
    if (db && /^phase65_platform_cj_[a-f0-9]{32}$/u.test(database)) await db.dropDatabase();
    await client?.close();
  });
  it('registers a strict existing-platform identity without granting any staff or tenant roles', async () => {
    const a = await customer(), raw = await db.collection('platform_users').findOne({ _id: a.userId } as never);
    expect(platformUserSchema.safeParse(raw).success).toBe(true);
    expect(await db.collection('platform_user_roles').countDocuments({ userId: a.userId })).toBe(0);
    expect(await db.collection('tenant_memberships').countDocuments({ platformUserId: a.userId })).toBe(0);
    await expect(admin.session(a.userId)).rejects.toMatchObject({ code: 'COMPANY_ACCESS_DENIED' });
  });
  it('makes registration retry-safe, normalizes duplicates and rejects injected roles', async () => {
    const input = { ...op(), fullName: 'Test client', email: `${randomUUID()}@example.test`, password };
    await accounts.register(input); await accounts.register(input);
    expect(await db.collection('customer_accounts').countDocuments({ email: input.email })).toBe(1);
    await expect(accounts.register({ ...input, password: password + 'x' })).rejects.toMatchObject({ code: 'CUSTOMER_IDEMPOTENCY_CONFLICT' });
    await expect(accounts.register({ ...input, ...op(), email: input.email.toUpperCase() })).rejects.toMatchObject({ code: 'CUSTOMER_REGISTRATION_CONFLICT' });
    await expect(accounts.register({ ...input, ...op(), roles: ['OWNER'] })).rejects.toMatchObject({ code: 'CUSTOMER_INPUT_INVALID' });
  });
  it('rejects stale profile edits and clears verification only when the phone changes', async () => {
    const a = await customer();
    await db.collection('customer_accounts').updateOne({ _id: a._id } as never, { $set: {
      phoneVerification: { status: 'VERIFIED', phoneE164: profile.phoneE164, verifiedAt: new Date() },
    } });
    await expect(accounts.profile(a.userId, { ...op(), version: 1, profile })).rejects.toMatchObject({ code: 'CUSTOMER_VERSION_CONFLICT' });
    const updated = await accounts.profile(a.userId, { ...op(), version: a.version, profile: { ...profile, phoneE164: '+966500000002' } });
    expect(updated.phoneVerification.status).toBe('UNVERIFIED');
  });
  it('does not leak unpublished prices or invent default features', async () => {
    const data = defaultCatalog().draft;
    data.packages[0].priceMinor = '99999'; data.packages[0].features = ['UNPUBLISHED'];
    await admin.saveCatalog(root, { ...op(), version: 0, data });
    const c = await accounts.publicCatalog();
    expect(c.packages).toEqual([]);
    expect(c.services).toEqual([]);
    expect(c.termsText).toBe('');
  });
  it('keeps customer registration separate from new-order intake', async () => {
    const data = defaultCatalog().draft;
    data.termsText = 'Synthetic test-only terms, not a real commercial or legal policy.';
    data.ordersOpen = false;
    const saved = await admin.saveCatalog(root, { ...op(), version: 0, data });
    await admin.publish(reviewer, { ...op(), version: saved.version, reason: 'Synthetic independent review' });
    const account = await customer();
    await expect(orders.create(account.userId, { ...op(), packageCode: 'Lite' }))
      .rejects.toMatchObject({ code: 'CUSTOMER_ORDERS_CLOSED' });
  });
  it('requires an independent catalog publisher and published terms before orders', async () => {
    const a = await customer();
    await expect(orders.create(a.userId, { ...op(), packageCode: 'Lite' })).rejects.toMatchObject({ code: 'CUSTOMER_CATALOG_UNPUBLISHED' });
    const data = defaultCatalog().draft; data.termsText = 'Synthetic explicit test terms for publication.';
    const c = await admin.saveCatalog(root, { ...op(), version: 0, data });
    await expect(admin.publish(root, { ...op(), version: c.version, reason: 'Self approval' })).rejects.toMatchObject({ code: 'CUSTOMER_INDEPENDENT_REVIEW_REQUIRED' });
    await admin.publish(reviewer, { ...op(), version: c.version, reason: 'Independent synthetic approval' });
  });
  it('blocks missing documents, duplicate open orders and missing explicit terms consent', async () => {
    const { account: a, order: o } = await draft();
    await expect(orders.create(a.userId, { ...op(), packageCode: 'Pro' })).rejects.toMatchObject({ code: 'CUSTOMER_OPEN_ORDER_EXISTS' });
    await expect(orders.action(a.userId, o._id, { ...op(), version: o.version, action: 'submit' })).rejects.toMatchObject({ code: 'CUSTOMER_TERMS_REQUIRED' });
    await expect(orders.action(a.userId, o._id, { ...op(), version: o.version, action: 'submit', acceptedTermsVersion: o.termsVersion })).rejects.toMatchObject({ code: 'CUSTOMER_DOCUMENTS_REQUIRED' });
  });
  it('isolates customers and retains document versions without exposing bytes', async () => {
    const { account: a, order: o } = await draft(), b = await customer();
    const first = await documents.upload(a.userId, o._id, file, { ...op(), key: 'license', version: 1 });
    const second = await documents.upload(a.userId, o._id, file, { ...op(), key: 'license', version: 2 });
    expect((await orders.get(a.userId, o._id)).documents).toHaveLength(1);
    expect(first).not.toHaveProperty('bytes'); expect(second).not.toHaveProperty('bytes');
    expect((await documents.download(a.userId, second._id)).bytes.equals(fileBytes)).toBe(true);
    await expect(orders.get(b.userId, o._id)).rejects.toMatchObject({ code: 'CUSTOMER_ORDER_NOT_FOUND' });
    await expect(documents.download(b.userId, first._id)).rejects.toMatchObject({ code: 'CUSTOMER_ORDER_NOT_FOUND' });
  });
  it('scopes account managers to assigned orders and excludes CTO', async () => {
    const { order } = await submitted();
    expect((await admin.list(accountManager, {})).items.map(x => x._id)).toEqual([order._id]);
    await expect(admin.list(tech, {})).rejects.toMatchObject({ code: 'COMPANY_PERMISSION_DENIED' });
    await expect(admin.action(accountManager, order._id, { ...op(), version: order.version,
      action: 'approve', reason: 'Unauthorized review' })).rejects.toMatchObject({ code: 'COMPANY_PERMISSION_DENIED' });
    const clients = await db.collection('company_records').find({ _id: order.clientId } as never).toArray();
    expect(clients[0].data.ownerId).toBe(managerId);
  });
  it('requires review of current documents and returns rejection reasons for correction', async () => {
    const { account: a, order: o, doc } = await submitted();
    await expect(admin.action(reviewer, o._id, { ...op(), version: o.version, action: 'approve', reason: 'Too early' }))
      .rejects.toMatchObject({ code: 'CUSTOMER_DOCUMENT_REVIEW_REQUIRED' });
    await documents.review(reviewer, doc._id, { ...op(), version: 1, decision: 'REJECTED', reason: 'Synthetic unclear document' });
    const changed = await admin.action(reviewer, o._id, { ...op(), version: o.version, action: 'request_changes', reason: 'Replace unclear document' });
    expect((await orders.get(a.userId, o._id)).documents[0].reason).toBe('Synthetic unclear document');
    expect(changed.status).toBe('CHANGES_REQUESTED');
  });
  it('does not send WhatsApp or allow activation without actual verification', async () => {
    const { account: a, order: o } = await approved();
    await expect(accounts.sendWhatsApp(a.userId)).rejects.toMatchObject({ code: 'CUSTOMER_WHATSAPP_UNAVAILABLE', status: 503 });
    await expect(admin.action(root, o._id, { ...op(), version: o.version, action: 'activate',
      reason: 'Must not bypass verification', tenantId: randomUUID(), subscriptionId: randomUUID() }))
      .rejects.toMatchObject({ code: 'CUSTOMER_PHONE_NOT_VERIFIED' });
    expect((await accounts.me(a.userId)).account.phoneVerification.status).toBe('UNVERIFIED');
    expect(await db.collection('tenants').countDocuments()).toBe(0);
  });
  it('rejects activation when the customer does not own the prepared tenant', async () => {
    const { account: a, order: o } = await approved(), links = await prepared(a, o);
    await db.collection('tenant_memberships').updateOne({ _id: links.membershipId } as never,
      { $set: { platformUserId: randomUUID() } });
    await expect(admin.action(root, o._id, { ...op(), version: o.version, action: 'activate',
      reason: 'Wrong owner synthetic check', tenantId: links.tenantId,
      subscriptionId: links.subscriptionId })).rejects.toMatchObject({ code: 'CUSTOMER_TENANT_NOT_READY' });
  });
  it('acknowledges a genuinely prepared synthetic account and accepts feedback only afterward', async () => {
    const { account: a, order: o } = await active();
    await expect(orders.review(a.userId, o._id, { ...op(), rating: 5, comment: 'Too early' }))
      .rejects.toMatchObject({ code: 'CUSTOMER_DELIVERY_REQUIRED' });
    const input = { ...op(), version: o.version, action: 'acknowledge' };
    const delivered = await orders.action(a.userId, o._id, input);
    expect(delivered.status).toBe('DELIVERED'); expect(delivered.open).toBe(false);
    expect((await orders.action(a.userId, o._id, input)).version).toBe(delivered.version);
    expect((await orders.review(a.userId, o._id, { ...op(), rating: 5, comment: 'Synthetic private feedback' })).rating).toBe(5);
    await expect(orders.review(a.userId, o._id, { ...op(), rating: 4, comment: 'Duplicate' })).rejects.toMatchObject({ code: 'CUSTOMER_REVIEW_EXISTS' });
  });
  it('removes delivery availability after subscription suspension', async () => {
    const { account: a, order: o } = await active();
    await db.collection('subscriptions').updateOne({ _id: o.subscriptionId } as never, { $set: { status: 'SUSPENDED' } });
    expect((await orders.get(a.userId, o._id)).delivery.available).toBe(false);
    await expect(orders.action(a.userId, o._id, { ...op(), version: o.version, action: 'acknowledge' }))
      .rejects.toMatchObject({ code: 'CUSTOMER_DELIVERY_NOT_READY' });
  });
  it('starts renewal as a fresh review without automatically extending the old subscription', async () => {
    const { account: a, order: o } = await active();
    const delivered = await orders.action(a.userId, o._id, { ...op(), version: o.version, action: 'acknowledge' });
    await expect(orders.create(a.userId, { ...op(), packageCode: 'Lite' })).rejects.toMatchObject({ code: 'CUSTOMER_RENEWAL_REQUIRED' });
    const renewal = await orders.create(a.userId, { ...op(), packageCode: 'Lite', parentOrderId: delivered._id });
    expect(renewal.purpose).toBe('RENEWAL'); expect(renewal.tenantId).toBe(delivered.tenantId);
    expect(renewal.subscriptionId).toBeNull(); expect(renewal.status).toBe('DRAFT');
  });
  it('calculates invoice totals in integers and independently issues an immutable number', async () => {
    const { order: o } = await active();
    const invoice = await billing.create(root, o._id, { ...op(), subtotalMinor: '10005',
      taxMinor: '1', description: 'Synthetic invoice', dueDate: '2026-12-01' });
    expect(invoice.totalMinor).toBe('10006');
    await expect(billing.action(root, invoice._id, { ...op(), version: 1, action: 'issue', reason: 'Self issue' }))
      .rejects.toMatchObject({ code: 'CUSTOMER_INDEPENDENT_REVIEW_REQUIRED' });
    const issued = await billing.action(reviewer, invoice._id, { ...op(), version: 1, action: 'issue', reason: 'Synthetic independent issue' });
    expect(issued.number).toMatch(/^TEST-\d{4}-000001$/u); expect(issued.status).toBe('ISSUED');
    await expect(billing.action(reviewer, issued._id, { ...op(), version: issued.version, action: 'link_payment',
      reason: 'Missing evidence', transferId: randomUUID() })).rejects.toMatchObject({ code: 'CUSTOMER_INVOICE_PAYMENT_INVALID' });
  });
  it('settles invoices only against exact, approved existing subscription transfers', async () => {
    const { order: o } = await active();
    const draft = await billing.create(root, o._id, { ...op(), subtotalMinor: '10005',
      taxMinor: '0', description: 'Synthetic invoice evidence', dueDate: '2026-12-01' });
    const invoice = await billing.action(reviewer, draft._id, { ...op(), version: 1, action: 'issue', reason: 'Synthetic issue' });
    const transferId = randomUUID();
    await db.collection('subscription_transfers').insertOne({
      _id: transferId, tenantId: o.tenantId, subscriptionId: o.subscriptionId,
      status: 'PENDING_REVIEW', amountMinor: '10005', currencyCode: 'SAR',
      receiptFileName: file.fileName, receiptMimeType: file.mimeType,
      receiptSha256: file.sha256, receiptBytes: new Binary(file.bytes), submittedBy: root,
      submittedAt: new Date(), reviewedBy: null, reviewedAt: null, reviewReason: null,
      version: 1, history: [], idempotencyKeyHash: null,
    } as never);
    const input = { ...op(), version: invoice.version, action: 'link_payment', reason: 'Synthetic linking', transferId };
    await expect(billing.action(reviewer, invoice._id, input)).rejects.toMatchObject({ code: 'CUSTOMER_INVOICE_PAYMENT_MISMATCH' });
    await db.collection('subscription_transfers').updateOne({ _id: transferId } as never, {
      $set: { status: 'APPROVED', reviewedBy: reviewer, reviewedAt: new Date(), reviewReason: 'Synthetic approval' },
    });
    const paid = await billing.action(reviewer, invoice._id, { ...input, ...op() });
    expect(paid.status).toBe('PAID');
    await expect(billing.action(reviewer, paid._id, { ...op(), version: paid.version, action: 'void', reason: 'Must not silently refund' }))
      .rejects.toMatchObject({ code: 'CUSTOMER_INVOICE_VOID_BLOCKED' });
  });
  it('fails closed without duplicating invoice numbers if the sequence counter is lost', async () => {
    const { order: o } = await active();
    const make = () => billing.create(root, o._id, { ...op(), subtotalMinor: '100', taxMinor: '0',
      description: 'Synthetic numbering fault', dueDate: '2026-12-01' });
    const first = await make();
    const issued = await billing.action(reviewer, first._id, { ...op(), version: 1, action: 'issue', reason: 'First issue' });
    await billing.action(reviewer, first._id, { ...op(), version: issued.version, action: 'void', reason: 'Synthetic void' });
    await db.collection('customer_counters').deleteMany({});
    const second = await make();
    await expect(billing.action(reviewer, second._id, { ...op(), version: 1, action: 'issue', reason: 'Counter-loss check' })).rejects.toBeDefined();
    expect(await db.collection('customer_invoices').countDocuments({ number: issued.number })).toBe(1);
    expect((await db.collection('customer_invoices').findOne({ _id: second._id } as never))?.status).toBe('DRAFT');
  });
  it('rolls back the business write and retry record when audit storage fails', async () => {
    await publish(); const a = await customer(), input = { ...op(), packageCode: 'Lite' };
    try {
      await db.command({ collMod: 'customer_events', validator: { action: { $ne: 'customer.order.create' } }, validationLevel: 'strict' });
      await expect(orders.create(a.userId, input)).rejects.toBeDefined();
      expect(await db.collection('customer_orders').countDocuments({ customerId: a._id })).toBe(0);
      expect(await db.collection('customer_commands').countDocuments({ _id: input.operationId } as never)).toBe(0);
    } finally { await db.command({ collMod: 'customer_events', validator: {}, validationLevel: 'strict' }); }
  });
});
