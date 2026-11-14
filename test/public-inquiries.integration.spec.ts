import { randomUUID } from 'node:crypto';
import { MongoClient, type Db } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConfigService } from '../src/config/config.service';
import {
  OfficialPlatformMongoClientFactory,
  PlatformMongoClientManager,
} from '../src/platform-mongo/platform-mongo.client.manager';
import type { JourneyStore } from '../src/customer-journey/journey.store';
import { JourneyInquiries } from '../src/customer-journey/journey.inquiries';

const uri = 'mongodb://127.0.0.1:45279/?directConnection=true';
if (process.env.PUBLIC_INQUIRY_TEST_MONGO_URI && process.env.PUBLIC_INQUIRY_TEST_MONGO_URI !== uri)
  throw new Error('Only the disposable credential-free loopback MongoDB fixture is allowed.');
const suite = process.env.PUBLIC_INQUIRY_TEST_MONGO_URI ? describe : describe.skip;
const database = `thanarah_public_inquiry_test_${randomUUID().replaceAll('-', '')}`;
type InquiryRow = { _id: string; payload: Record<string, unknown> };

suite('Website inquiry persistence in disposable MongoDB', () => {
  let db: Db;
  let client: MongoClient;
  let manager: PlatformMongoClientManager;
  let service: JourneyInquiries;
  const input = {
    operationId: randomUUID(),
    fullName: 'Synthetic clinic owner',
    email: 'SYNTHETIC@EXAMPLE.TEST',
    organization: 'Isolated test clinic',
    topic: 'general',
    message: 'Isolated persistence test, not a real inquiry.',
    consent: true,
    website: '',
    locale: 'ar',
  };
  beforeAll(async () => {
    client = await new MongoClient(uri, { serverSelectionTimeoutMS: 5000 }).connect();
    db = client.db(database);
    manager = new PlatformMongoClientManager(
      {
        platformMongoUri: uri,
        platformMongoDatabase: database,
      } as ConfigService,
      new OfficialPlatformMongoClientFactory(),
    );
    service = new JourneyInquiries(manager, {} as JourneyStore);
  });
  afterAll(async () => {
    if (db && /^thanarah_public_inquiry_test_[a-f0-9]+$/u.test(db.databaseName))
      await db.dropDatabase();
    await manager?.onApplicationShutdown();
    await client?.close();
  });
  it('stores a normalized business lead with BSON date and consent in the current backend model', async () => {
    const receipt = await service.create(input);
    const row = await db
      .collection<InquiryRow>('customer_inquiries')
      .findOne({ _id: input.operationId });
    expect(row).toMatchObject({
      reference: receipt.reference,
      status: 'NEW',
      createdAt: expect.any(Date),
      payload: { email: 'synthetic@example.test', consent: true },
    });
    expect(row?.payload).not.toHaveProperty('website');
    expect(row?.payload).not.toHaveProperty('operationId');
    expect(receipt).not.toHaveProperty('email');
  });
  it('returns the same persisted receipt from a new service instance without duplicating', async () => {
    const receipt = await service.create(input);
    const fresh = new JourneyInquiries(manager, {} as JourneyStore);
    expect(await fresh.create(input)).toEqual(receipt);
    expect(await db.collection('customer_inquiries').countDocuments()).toBe(1);
  });
  it('serializes concurrent retries through MongoDB unique _id rather than a process-local cache', async () => {
    const concurrent = { ...input, operationId: randomUUID() };
    const receipts = await Promise.all(
      Array.from({ length: 12 }, () => service.create(concurrent)),
    );
    expect(new Set(receipts.map((receipt) => JSON.stringify(receipt))).size).toBe(1);
    expect(
      await db
        .collection<{ _id: string }>('customer_inquiries')
        .countDocuments({ _id: concurrent.operationId }),
    ).toBe(1);
  });
  it('does not overwrite a stored lead on reference conflict', async () => {
    await expect(
      service.create({ ...input, message: 'A changed inquiry must not replace the original.' }),
    ).rejects.toMatchObject({ status: 409 });
    const row = await db
      .collection<InquiryRow>('customer_inquiries')
      .findOne({ _id: input.operationId });
    expect(row?.payload.message).toBe(input.message);
  });
});
