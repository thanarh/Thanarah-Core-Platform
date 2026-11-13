const { MongoClient } = require('mongodb');
const { provisionJourneyIndexes } = require('../dist/customer-journey/journey.indexes');
const { provisionOperationsIndexes } = require('../dist/internal-operations/operations.indexes');
(async () => {
  if (process.env.NODE_ENV !== 'development' ||
      !/(?:^|[_-])(?:dev|test)(?:[_-]|$)/iu.test(process.env.PLATFORM_MONGO_DATABASE || '') ||
      !/^[A-Za-z0-9_-]{1,63}$/u.test(process.env.PLATFORM_MONGO_DATABASE || '') ||
      !process.env.PLATFORM_MONGO_URI) throw new Error('Development configuration required.');
  const client = new MongoClient(process.env.PLATFORM_MONGO_URI, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000 });
  try {
    await client.connect();
    const db = client.db(process.env.PLATFORM_MONGO_DATABASE);
    await provisionOperationsIndexes(db);
    await provisionJourneyIndexes(db);
    console.log('Initialized customer journey indexes only; no accounts, policies or prices were created.');
  } finally { await client.close(); }
})().catch(() => { console.error('Customer initialization failed or was blocked. No credentials printed.'); process.exitCode = 1; });
