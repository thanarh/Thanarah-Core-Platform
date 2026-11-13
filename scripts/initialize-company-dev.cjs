const { MongoClient } = require('mongodb');
const { provisionOperationsIndexes } = require('../dist/internal-operations/operations.indexes');
(async () => {
  if (process.env.NODE_ENV !== 'development' ||
      !/(?:^|[_-])(?:dev|test)(?:[_-]|$)/iu.test(process.env.PLATFORM_MONGO_DATABASE || '') ||
      !/^[A-Za-z0-9_-]{1,63}$/u.test(process.env.PLATFORM_MONGO_DATABASE || '') ||
      !process.env.PLATFORM_MONGO_URI) throw new Error('Development configuration required.');
  const client = new MongoClient(process.env.PLATFORM_MONGO_URI, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000 });
  try {
    await client.connect();
    await provisionOperationsIndexes(client.db(process.env.PLATFORM_MONGO_DATABASE));
    console.log('Initialized company indexes only; no business records, users or policies were created.');
  } finally { await client.close(); }
})().catch(() => { console.error('Company initialization failed or was blocked. No credentials printed.'); process.exitCode = 1; });
