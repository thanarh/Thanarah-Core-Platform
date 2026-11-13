const { MongoClient } = require('mongodb');
const { randomUUID } = require('node:crypto');
const { provisionPlatformMongoIndexes } = require('../dist/platform-mongo/platform-mongo.indexes');
const { initializeMongoReferenceData } = require('../dist/platform-mongo/platform-mongo.initialize');
const { platformUserSchema, platformUserRoleSchema, stableAssignmentId, documentTimestamps } = require('../dist/platform-mongo/platform-mongo.models');
const { PasswordHasherService } = require('../dist/auth/security/password-hasher.service');
const { PasswordPolicyService } = require('../dist/auth/security/password-policy.service');

async function main() {
  const configured = Boolean(process.env.PLATFORM_MONGO_URI && process.env.PLATFORM_MONGO_DATABASE);
  const safeDatabase = /(?:^|[_-])(?:dev|test)(?:[_-]|$)/iu.test(process.env.PLATFORM_MONGO_DATABASE || '') &&
    /^[A-Za-z0-9_-]{1,63}$/u.test(process.env.PLATFORM_MONGO_DATABASE || '');
  if (process.argv.includes('--check-config')) {
    console.log(JSON.stringify({ provider: 'mongodb', configured, developmentDatabaseNameSafe: safeDatabase }));
    return;
  }
  if (process.env.NODE_ENV !== 'development' || !configured || !safeDatabase) {
    throw new Error('Blocked: explicit development MongoDB configuration and a dev/test database name are required.');
  }
  const referencesOnly = process.argv.includes('--references-only');
  let passwordHash;
  if (!referencesOnly) {
    if (!process.env.BOOTSTRAP_PASSWORD || process.env.BOOTSTRAP_PASSWORD.length < 14) {
      throw new Error('Blocked: a password of at least 14 characters is required.');
    }
    new PasswordPolicyService().validate(process.env.BOOTSTRAP_PASSWORD);
    passwordHash = await new PasswordHasherService().hash(process.env.BOOTSTRAP_PASSWORD);
    process.env.BOOTSTRAP_PASSWORD = '';
  }
  const client = new MongoClient(process.env.PLATFORM_MONGO_URI, {
    serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000, monitorCommands: false,
  });
  try {
    await client.connect();
    const db = client.db(process.env.PLATFORM_MONGO_DATABASE);
    await provisionPlatformMongoIndexes(db);
    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        await initializeMongoReferenceData(db, session);
        if (referencesOnly) return;
        const existing = await db.collection('platform_users').findOne(
          { email: 'admin@thanarah.com' }, { session, collation: { locale: 'en', strength: 1 } },
        );
        if (existing) throw new Error('The development administrator already exists; no account changes were made.');
        const role = await db.collection('platform_roles').findOne({ code: 'SUPER_ADMIN' }, { session });
        if (!role) throw new Error('The platform role catalog is incomplete.');
        const user = platformUserSchema.parse({
          _id: randomUUID(), ...documentTimestamps(), schemaVersion: 1,
          email: 'admin@thanarah.com', fullName: 'Platform Administrator', passwordHash,
          status: 'ACTIVE', tokenVersion: 0, failedLoginAttempts: 0, lockedUntil: null,
        });
        await db.collection('platform_users').insertOne(user, { session });
        await db.collection('platform_user_roles').insertOne(platformUserRoleSchema.parse({
          _id: stableAssignmentId(user._id, role._id), userId: user._id, roleId: role._id,
        }), { session });
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    } finally { await session.endSession(); }
    console.log(referencesOnly ? 'Initialized MongoDB development indexes and reference catalogs without creating or changing accounts.'
      : 'Created the development platform administrator with SUPER_ADMIN in MongoDB.');
  } finally {
    process.env.BOOTSTRAP_PASSWORD = '';
    await client.close();
  }
}
main().catch(() => {
  process.env.BOOTSTRAP_PASSWORD = '';
  console.error('Development MongoDB initialization failed or was blocked; no credentials were printed. Check configuration, prerequisites, and whether the administrator already exists.');
  process.exitCode = 1;
});
