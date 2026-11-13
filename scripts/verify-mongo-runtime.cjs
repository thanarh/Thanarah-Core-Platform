const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { MongoClient } = require('mongodb');
const { createApplication } = require('../dist/main');
const { provisionPlatformMongoIndexes } = require('../dist/platform-mongo/platform-mongo.indexes');
const { initializeMongoReferenceData } = require('../dist/platform-mongo/platform-mongo.initialize');
const { documentTimestamps, stableAssignmentId, platformUserSchema } = require('../dist/platform-mongo/platform-mongo.models');
const { PasswordHasherService } = require('../dist/auth/security/password-hasher.service');
const { MongoTenantStorageRegistryService } = require('../dist/platform-mongo/mongo-tenant-storage-registry.service');
const { MongoTenantStorageActivationService } = require('../dist/platform-mongo/mongo-tenant-storage-activation.service');

async function main() {
  if (!/^phase65_platform_[A-Za-z0-9_]+_runtime$/u.test(process.env.PLATFORM_MONGO_DATABASE || '') ||
    !/^mongodb:\/\/127\.0\.0\.1:45271,127\.0\.0\.1:45272,127\.0\.0\.1:45273\/\?replicaSet=rs0&retryWrites=true$/u.test(process.env.PLATFORM_MONGO_URI || '')) {
    throw new Error('Only the disposable loopback runtime fixture is allowed');
  }
  const client = new MongoClient(process.env.PLATFORM_MONGO_URI, { serverSelectionTimeoutMS: 5000 });
  let app;
  const dbName = process.env.PLATFORM_MONGO_DATABASE;
  let clinicalName;
  try {
    await client.connect();
    const db = client.db(dbName);
    await provisionPlatformMongoIndexes(db);
    const session = client.startSession();
    try { await session.withTransaction(() => initializeMongoReferenceData(db, session)); }
    finally { await session.endSession(); }
    const userId = randomUUID();
    const password = `Synthetic-Aa1!-${randomUUID()}`;
    const email = `${userId}@example.test`;
    const now = new Date();
    await db.collection('platform_users').insertOne(platformUserSchema.parse({
      _id: userId, ...documentTimestamps(now), schemaVersion: 1, email, fullName: 'Synthetic administrator',
      passwordHash: await new PasswordHasherService().hash(password), status: 'ACTIVE',
      tokenVersion: 0, failedLoginAttempts: 0, lockedUntil: null,
    }));
    const ownerId = randomUUID();
    const ownerEmail = `${ownerId}@example.test`;
    await db.collection('platform_users').insertOne(platformUserSchema.parse({
      _id: ownerId, ...documentTimestamps(now), schemaVersion: 1, email: ownerEmail, fullName: 'Synthetic clinic owner',
      passwordHash: await new PasswordHasherService().hash(password), status: 'ACTIVE',
      tokenVersion: 0, failedLoginAttempts: 0, lockedUntil: null,
    }));
    const role = await db.collection('platform_roles').findOne({ code: 'SUPER_ADMIN' });
    assert.ok(role);
    await db.collection('platform_user_roles').insertOne({ _id: stableAssignmentId(userId, role._id), userId, roleId: role._id });
    async function start() {
      app = await createApplication();
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      assert.ok(!Object.keys(require.cache).some(path => /node_modules\/(?:@prisma\/client|\.prisma\/client)\//u.test(path)),
        'Application must not load generated Prisma classes or the SQL client');
    }
    await start();
    async function request(method, url, payload, expected, headers = {}) {
      const response = await app.inject({ method, url, ...(payload === undefined ? {} : { payload }), headers });
      assert.equal(response.statusCode, expected, `${method} ${url}: ${response.body}`);
      return response;
    }
    let token;
    let tenantToken;
    let refreshCookie;
    function auth(extra = {}) { return { authorization: `Bearer ${token}`, ...extra }; }
    const login = await request('POST', '/api/v1/auth/login', { email, password }, 200);
    token = login.json().accessToken;
    assert.ok(token);
    refreshCookie = [].concat(login.headers['set-cookie'] || [])[0]?.split(';')[0];
    assert.ok(refreshCookie);
    await request('GET', '/ready', undefined, 200);
    const tenant = (await request('POST', '/api/v1/platform/tenants', { slug: `synthetic-${randomUUID()}`, legalName: 'Synthetic clinic' }, 201, auth())).json();
    assert.ok(tenant.id);
    await request('POST', `/api/v1/platform/tenants/${tenant.id}/memberships`, { platformUserId: userId }, 403, auth());
    const membership = (await request('POST', `/api/v1/platform/tenants/${tenant.id}/memberships`, { platformUserId: ownerId }, 201, auth())).json();
    await request('POST', `/api/v1/platform/tenants/${tenant.id}/memberships/${membership.id}/activate`, {}, 200, auth());
    await request('POST', `/api/v1/platform/tenants/${tenant.id}/roles/bootstrap`, { platformUserId: ownerId }, 200, auth());
    const ownerLogin = await request('POST', '/api/v1/auth/login', { email: ownerEmail, password }, 200);
    tenantToken = ownerLogin.json().accessToken;
    const ownerCookie = [].concat(ownerLogin.headers['set-cookie'] || [])[0]?.split(';')[0];
    assert.ok(ownerCookie);
    clinicalName = `${dbName}_clinical`;
    const target = await app.get(MongoTenantStorageRegistryService).registerTarget(tenant.id, clinicalName);
    await app.get(MongoTenantStorageActivationService).setTargetStatus(tenant.id, target.id, 'ACTIVE');
    await app.get(MongoTenantStorageActivationService).setPrimaryTarget(tenant.id, target.id);
    // Clinical routes use real authentication and the server-validated tenant header.
    const tenantAuth = () => ({ authorization: `Bearer ${tenantToken}`, 'x-tenant-id': tenant.id });
    await request('GET', '/api/v1/session/tenants', undefined, 200, tenantAuth());
    await request('GET', '/api/v1/platform/plans', undefined, 200, auth());
    await request('GET', '/api/v1/platform/subscriptions', undefined, 200, auth());
    const plan = (await request('POST', '/api/v1/platform/plans', { key: 'SYNTHETIC_RUNTIME', name: 'Synthetic plan' }, 201, auth())).json();
    const subscription = (await request('POST', '/api/v1/platform/subscriptions', {
      tenantId: tenant.id, planId: plan.id, startsAt: new Date(Date.now() - 60_000).toISOString(),
    }, 201, auth())).json();
    assert.ok(subscription.id);
    const prefix = `/api/v1/tenants/${tenant.id}`;
    const facility = (await request('POST', `${prefix}/facilities`, { name: 'Synthetic facility' }, 201, tenantAuth())).json();
    const staff = (await request('POST', `${prefix}/staff`, { membershipId: membership.id, displayName: 'Synthetic doctor' }, 201, tenantAuth())).json();
    await request('POST', `${prefix}/staff/${staff.id}/facilities`, { facilityId: facility.id }, 201, tenantAuth());
    const doctor = (await request('POST', `${prefix}/doctors`, { staffId: staff.id }, 201, tenantAuth())).json();
    const service = (await request('POST', `${prefix}/services`, { name: 'Synthetic consultation' }, 201, tenantAuth())).json();
    await request('POST', `${prefix}/doctors/${doctor.id}/services`, { serviceId: service.id, facilityId: facility.id }, 201, tenantAuth());
    const policyUrl = `${prefix}/facilities/${facility.id}/scheduling-policy`;
    await request('PUT', policyUrl, { timeZone: 'Asia/Riyadh', rules: {
      allowedDurationsMinutes: [30],
      operatingHours: Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(day => [day, [{ start: '00:00', end: '23:59' }]])),
    } }, 200, tenantAuth());
    await request('POST', `${policyUrl}/activate`, { expectedVersion: 1 }, 200, tenantAuth());
    const patient = (await request('POST', `${prefix}/patients`, {
      patientNumber: 'SYNTHETIC-1', firstName: 'Synthetic', lastName: 'Patient',
    }, 201, tenantAuth())).json();
    const startsAt = new Date(Date.now() + 2 * 86400_000);
    startsAt.setUTCMinutes(0, 0, 0);
    const appointment = (await request('POST', `${prefix}/appointments`, {
      patientId: patient.id, doctorId: doctor.id, facilityId: facility.id, serviceId: service.id,
      startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + 30 * 60_000).toISOString(),
    }, 201, tenantAuth())).json();
    assert.ok(appointment.id);
    const encounterHeaders = { ...tenantAuth(), 'idempotency-key': 'synthetic-encounter-create' };
    const encounter = (await request('POST', `${prefix}/encounters/from-appointment`, { appointmentId: appointment.id }, 201, encounterHeaders)).json();
    assert.ok(encounter.id);
    const replay = (await request('POST', `${prefix}/encounters/from-appointment`, { appointmentId: appointment.id }, 201, encounterHeaders)).json();
    assert.equal(replay.id, encounter.id);
    assert.ok(await db.collection('encounter_operations').findOne({ tenantId: tenant.id, resourceId: encounter.id, mutationState: 'CONFIRMED' }));
    const foreignTenant = (await request('POST', '/api/v1/platform/tenants', { slug: `foreign-${randomUUID()}`, legalName: 'Other synthetic clinic' }, 201, auth())).json();
    await request('GET', `/api/v1/tenants/${foreignTenant.id}/patients/${patient.id}`, undefined, 403, auth());
    assert.equal((await app.inject({ method: 'GET', url: '/appointments/' })).statusCode, 200);
    await app.listen(0, '127.0.0.1');
    const origin = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    await require('./verify-mongo-browser.cjs')({ origin, email: ownerEmail, password, facilityId: facility.id, doctorId: doctor.id });
    // A missing invariant blocks readiness, then recovers after explicit index repair.
    await db.collection('encounter_operations').dropIndex('ux_encounter_operation_history');
    await request('GET', '/ready', undefined, 503);
    await request('GET', '/health', undefined, 200);
    await provisionPlatformMongoIndexes(db);
    await request('GET', '/ready', undefined, 200);
    // A dependency error must not become a bad-credentials response or clear refresh cookies.
    await client.db('admin').command({ configureFailPoint: 'failCommand', mode: { times: 1 }, data: {
      failCommands: ['find'], appName: 'thanarah-platform-storage', errorCode: 13,
    } });
    try {
      const unavailable = await request('POST', '/api/v1/auth/refresh', {}, 503, { cookie: refreshCookie });
      assert.ok(!String(unavailable.headers['set-cookie'] || '').includes('Max-Age=0'));
    } finally { await client.db('admin').command({ configureFailPoint: 'failCommand', mode: 'off' }); }
    const refresh = await request('POST', '/api/v1/auth/refresh', {}, 200, { cookie: refreshCookie });
    token = refresh.json().accessToken;
    const rotatedCookie = [].concat(refresh.headers['set-cookie'] || [])[0]?.split(';')[0];
    assert.ok(rotatedCookie);
    await app.close();
    app = undefined;
    await start();
    await request('GET', '/ready', undefined, 200);
    await request('GET', '/api/v1/platform/tenants', undefined, 200, auth());
    await request('GET', `${prefix}/patients/${patient.id}`, undefined, 200, tenantAuth());
    await request('GET', `${prefix}/encounters/${encounter.id}`, undefined, 200, tenantAuth());
    await request('POST', '/api/v1/auth/refresh', {}, 401, { cookie: refreshCookie });
    await request('POST', '/api/v1/auth/refresh', {}, 401, { cookie: rotatedCookie });
    await request('GET', '/api/v1/platform/tenants', undefined, 401, auth());
    await request('POST', '/api/v1/auth/logout-all', {}, 204, tenantAuth());
    await request('GET', `${prefix}/patients/${patient.id}`, undefined, 401, tenantAuth());
    await request('POST', '/api/v1/auth/refresh', {}, 401, { cookie: ownerCookie });
    console.log('MONGO_ONLY_RUNTIME_PASSED');
  } finally {
    if (app) await app.close();
    try {
      if (clinicalName) await client.db(clinicalName).dropDatabase();
      await client.db(dbName).dropDatabase();
    } finally { await client.close(); }
  }
}
main().catch((error) => {
  console.error('Mongo-only runtime verification failed. See the assertion output below only for synthetic fixture data.');
  console.error(error);
  process.exitCode = 1;
});
