// Disposable loopback application for browser acceptance. Never uses saved Mongo secrets.
const { MongoClient } = require('mongodb');
const { randomUUID, randomBytes } = require('node:crypto');
const uri = 'mongodb://127.0.0.1:45271,127.0.0.1:45272,127.0.0.1:45273/?replicaSet=rs0&retryWrites=true';
const database = `phase65_platform_cob_${randomUUID().replaceAll('-', '')}`;
Object.assign(process.env, {
  NODE_ENV: 'development', PLATFORM_MONGO_URI: uri, PLATFORM_MONGO_DATABASE: database,
  TENANT_STORAGE_PROVIDER: 'mongodb', TENANT_STORAGE_MONGO_URI: uri,
  JWT_ACCESS_SECRET: randomBytes(48).toString('base64url'),
  JWT_REFRESH_SECRET: randomBytes(48).toString('base64url'),
});
const { provisionPlatformMongoIndexes } = require('../dist/platform-mongo/platform-mongo.indexes');
const { initializeMongoReferenceData } = require('../dist/platform-mongo/platform-mongo.initialize');
const { provisionOperationsIndexes } = require('../dist/internal-operations/operations.indexes');
const { PasswordHasherService } = require('../dist/auth/security/password-hasher.service');
const { platformUserSchema, documentTimestamps, stableAssignmentId } = require('../dist/platform-mongo/platform-mongo.models');
const { createApplication } = require('../dist/main');
const { OperationsRecords } = require('../dist/internal-operations/operations.records');

(async () => {
  const client = new MongoClient(uri);
  let app;
  let stopping = false;
  async function cleanup() {
    if (stopping) return;
    stopping = true;
    try { if (app) await app.close(); } catch {}
    try {
      if (/^phase65_platform_cob_[a-f0-9]{32}$/.test(database)) await client.db(database).dropDatabase();
    } catch {}
    await client.close();
    process.exit(0);
  }
  process.once('SIGTERM', () => void cleanup());
  process.once('SIGINT', () => void cleanup());
  try {
    await client.connect();
    const db = client.db(database);
    await provisionPlatformMongoIndexes(db);
    await provisionOperationsIndexes(db);
    if (process.env.CUSTOMER_BROWSER_FIXTURE === 'true') {
      await require('../dist/customer-journey/journey.indexes').provisionJourneyIndexes(db);
    }
    const session = client.startSession();
    try { await session.withTransaction(() => initializeMongoReferenceData(db, session)); }
    finally { await session.endSession(); }
    // Deliberately public, synthetic fixture password; no real credentials are read.
    const passwordHash = await new PasswordHasherService().hash('Synthetic-Company-Only!2026');
    const users = {};
    const role = await db.collection('platform_roles').findOne({ code: 'SUPER_ADMIN' });
    for (const [label, email] of Object.entries({
      maker: 'company-maker@example.test', reviewer: 'company-reviewer@example.test', cto: 'company-cto@example.test',
    })) {
      const user = platformUserSchema.parse({
        _id: randomUUID(), ...documentTimestamps(), schemaVersion: 1, email,
        fullName: `Synthetic company ${label}`, passwordHash, status: 'ACTIVE',
        tokenVersion: 0, failedLoginAttempts: 0, lockedUntil: null,
      });
      users[label] = user._id;
      await db.collection('platform_users').insertOne(user);
      if (label !== 'cto') await db.collection('platform_user_roles').insertOne({
        _id: stableAssignmentId(user._id, role._id), userId: user._id, roleId: role._id,
      });
    }
    app = await createApplication();
    const records = app.get(OperationsRecords);
    const create = (kind, data) => records.write(users.maker, kind, { operationId: randomUUID(), data });
    const unit = await create('units', { name: 'شركة اختبار متصفح ثنارة', unitType: 'COMPANY', parentId: null, status: 'ACTIVE' });
    await create('employees', { name: 'مسؤول التقنية التجريبي', userId: users.cto, unitId: unit._id, jobTitle: 'CTO', roleIds: ['CTO'], status: 'ACTIVE' });
    await create('employees', { name: 'موظف استحقاق تجريبي', userId: null, unitId: unit._id, jobTitle: 'Specialist', roleIds: [], status: 'ACTIVE' });
    if (process.env.CUSTOMER_BROWSER_FIXTURE === 'true') {
      const { JourneyAdmin } = require('../dist/customer-journey/journey.admin');
      const { platformPlanSchema } = require('../dist/platform-mongo/platform-mongo.models');
      const manager = await create('employees', { name: 'مدير حساب اختبار الرحلة', userId: users.maker, unitId: unit._id, jobTitle: 'Account manager', roleIds: ['ACCOUNT_MANAGER'], status: 'ACTIVE' });
      const plan = platformPlanSchema.parse({
        _id: randomUUID(), ...documentTimestamps(), schemaVersion: 1,
        key: 'synthetic-journey', name: 'خطة اختبار معزولة', description: null,
        status: 'ACTIVE', statusChangedAt: new Date(),
      });
      await db.collection('platform_plans').insertOne(plan);
      const admin = app.get(JourneyAdmin);
      const catalog = await admin.saveCatalog(users.maker, {
        operationId: randomUUID(), version: 0, data: {
          registrationOpen: true,
          termsText: 'شروط اصطناعية للاختبار المعزول فقط، لا تمثل عقد ثنارة أو سياسة تشغيل معتمدة.',
          services: [{ key: 'synthetic-service', title: 'خدمة اختبار رحلة العميل', description: 'محتوى اصطناعي داخل قاعدة مؤقتة فقط.', published: true }],
          packages: ['Lite', 'Pro', 'Customize'].map(code => ({
            code, description: 'باقة اختبار اصطناعية', features: ['خاصية اختبار وليست وعدًا تجاريًا'],
            planId: plan._id, priceMinor: '10005', published: true,
          })),
          documents: [{ key: 'license', label: 'وثيقة اختبار المنشأة', required: true }],
          seller: { name: 'بائع اصطناعي', address: 'عنوان اختبار غير حقيقي', taxNumber: 'SYNTHETIC', prefix: 'TEST' },
        },
      });
      await admin.publish(users.reviewer, { operationId: randomUUID(), version: catalog.version, reason: 'Synthetic isolated browser acceptance only' });
      console.log('Disposable customer journey catalog and account manager ready; WhatsApp deliberately unconfigured.');
    }
    for (const [code, name, type] of [
      ['100', 'صندوق اختبار المتصفح', 'ASSET'], ['110', 'بنك اختبار المتصفح', 'ASSET'],
      ['200', 'مستحقات اختبار المتصفح', 'LIABILITY'], ['300', 'حقوق ملكية اختبار المتصفح', 'EQUITY'],
      ['400', 'إيرادات اختبار المتصفح', 'REVENUE'], ['500', 'مصروفات اختبار المتصفح', 'EXPENSE'],
    ]) await create('accounts', { code, name, type, currency: 'SAR', status: 'ACTIVE' });
    await app.listen(5000, '0.0.0.0');
    console.log('Disposable company browser fixture ready on port 5000. Synthetic users only.');
  } catch {
    console.error('Disposable company browser fixture failed; no credentials printed.');
    await cleanup();
    process.exitCode = 1;
  }
})();
