import { randomBytes, randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { join, resolve } from 'node:path';
import {
  PlatformAuditEventType,
  PlatformSessionStatus,
  PrismaClient,
  TenantMembershipStatus,
  TenantStatus,
  TenantStorageTargetStatus,
  UserStatus,
} from '@prisma/client';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test, type TestingModule } from '@nestjs/testing';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { MongoClient, type Db } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConfigService } from '../dist/config/config.service';
import type { TenantMongoClientFactory } from '../dist/tenant/tenant-mongo-client.manager';
import type { TenantStorageTargetRecord } from '../dist/tenant/tenant-storage.registry';
import type { TrustedTenantContext } from '../dist/tenant/tenant-context.contract';
import type {
  TenantStoragePlacementId,
  TenantStorageRoute,
} from '../dist/tenant/tenant-storage.contract';

const requireFromWorkspace = createRequire(
  resolve(process.cwd(), 'test/phase30-patient.integration.spec.ts'),
);
const { AccessTokenService } = requireFromWorkspace('../dist/auth/services/access-token.service');
const { APP_CONSTANTS } = requireFromWorkspace('../dist/common/constants/app.constants');
const { PrismaService } = requireFromWorkspace('../dist/database/prisma.service');
const { MongoTenantPatientStorage } = requireFromWorkspace(
  '../dist/tenant/mongo-tenant-patient.storage',
);
const { OfficialTenantMongoClientFactory, TENANT_MONGO_CLIENT_FACTORY, TenantMongoClientManager } =
  requireFromWorkspace('../dist/tenant/tenant-mongo-client.manager');
const { PatientService } = requireFromWorkspace('../dist/tenant/patient.service');
const { TenantStoragePatientRepository } = requireFromWorkspace(
  '../dist/tenant/patient.repository',
);
const { TenantStorageRegistryService } = requireFromWorkspace(
  '../dist/tenant/tenant-storage.registry',
);
const { TenantMembershipValidatorService, TrustedTenantContextFactoryService } =
  requireFromWorkspace('../dist/tenant/tenant-context.service');
const { TenantStorageResolverService } = requireFromWorkspace(
  '../dist/tenant/tenant-storage.resolver',
);
const { TenantStorageNotConfiguredError, TenantStorageUnavailableError } = requireFromWorkspace(
  '../dist/tenant/tenant-storage.errors',
);
const { TENANT_PATIENT_STORAGE } = requireFromWorkspace('../dist/tenant/tenant-patient.storage');

const DOCKER_SOCKET = 'unix:///var/run/docker.sock';
const MONGO_IMAGE = 'mongo:7.0.17';
const MYSQL_IMAGE = 'mysql:8.0.41';
const MONGO_ROOT_USER = 'phase30_test_root';
const RUN_ID = randomBytes(6).toString('hex');
const TEST_MYSQL_DATABASE = `phase30_${RUN_ID}`;
const TEST_MYSQL_USER = 'phase30_test';
const PATIENT_COLLECTION = 'patients';

interface TestTenant {
  id: string;
  membershipId: string;
  roleId: string;
  databaseName: string;
  slug: string;
}

class TrackingRealMongoClientFactory implements TenantMongoClientFactory {
  readonly clients: MongoClient[] = [];
  private readonly closedClients = new Set<MongoClient>();

  get closeCount(): number {
    return this.closedClients.size;
  }

  create(
    uri: string,
    options: Parameters<TenantMongoClientFactory['create']>[1],
  ): ReturnType<TenantMongoClientFactory['create']> {
    const client = new MongoClient(uri, options);
    this.clients.push(client);
    return {
      connect: async (): Promise<unknown> => client.connect(),
      db: (databaseName: string): Db => client.db(databaseName),
      close: async (force?: boolean): Promise<void> => {
        this.closedClients.add(client);
        await client.close(force);
      },
    };
  }
}

const mongoFactory = new TrackingRealMongoClientFactory();
const tenantA = createTestTenant('tenant_a');
const tenantB = createTestTenant('tenant_b');
let mongoContainer: StartedTestContainer | undefined;
let mysqlContainer: StartedTestContainer | undefined;
let mongoAdminClient: MongoClient | undefined;
let application: NestFastifyApplication | undefined;
let mongoUri = '';
let mysqlUri = '';
let mongoPassword = '';
let mysqlPassword = '';
let accessToken = '';
let targetA: TenantStorageTargetRecord;
let targetB: TenantStorageTargetRecord;
let contextA: TrustedTenantContext;
let contextB: TrustedTenantContext;
let platformUserId = '';
let platformSessionId = '';
let readPermissionId = '';
let managePermissionId = '';

describe('Phase 30 real MongoDB Patient runtime verification', () => {
  beforeAll(async () => {
    if (process.env.DOCKER_HOST !== DOCKER_SOCKET) {
      throw new Error('Phase 30 requires the explicitly selected local Docker socket');
    }

    mongoPassword = randomBytes(24).toString('hex');
    mysqlPassword = randomBytes(24).toString('hex');

    mongoContainer = await new GenericContainer(MONGO_IMAGE)
      .withEnvironment({
        MONGO_INITDB_ROOT_USERNAME: MONGO_ROOT_USER,
        MONGO_INITDB_ROOT_PASSWORD: mongoPassword,
      })
      .withExposedPorts(27017)
      .withWaitStrategy(Wait.forLogMessage(/Waiting for connections/, 1))
      .withStartupTimeout(120_000)
      .start();

    mysqlContainer = await new GenericContainer(MYSQL_IMAGE)
      .withEnvironment({
        MYSQL_ROOT_PASSWORD: randomBytes(24).toString('hex'),
        MYSQL_DATABASE: TEST_MYSQL_DATABASE,
        MYSQL_USER: TEST_MYSQL_USER,
        MYSQL_PASSWORD: mysqlPassword,
      })
      .withExposedPorts(3306)
      .withWaitStrategy(Wait.forLogMessage(/ready for connections.*port: 3306/i, 1))
      .withStartupTimeout(120_000)
      .start();

    const mongoHost = mongoContainer.getHost();
    const mongoPort = mongoContainer.getMappedPort(27017);
    mongoUri = `mongodb://${encodeURIComponent(MONGO_ROOT_USER)}:${encodeURIComponent(
      mongoPassword,
    )}@${mongoHost}:${mongoPort}/?authSource=admin`;
    mongoAdminClient = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 10_000 });
    await mongoAdminClient.connect();

    const mysqlHost = mysqlContainer.getHost();
    const mysqlPort = mysqlContainer.getMappedPort(3306);
    mysqlUri = `mysql://${encodeURIComponent(TEST_MYSQL_USER)}:${encodeURIComponent(
      mysqlPassword,
    )}@${mysqlHost}:${mysqlPort}/${TEST_MYSQL_DATABASE}`;

    // Replace, rather than inherit, all application connection and signing settings.
    Object.assign(process.env, {
      NODE_ENV: 'development',
      PORT: '3000',
      DATABASE_URL: mysqlUri,
      TENANT_STORAGE_PROVIDER: 'mongodb',
      TENANT_STORAGE_MONGO_URI: mongoUri,
      JWT_ACCESS_SECRET: randomBytes(48).toString('base64url'),
      SESSION_SECRET: randomBytes(48).toString('base64url'),
      AUTH_ACCESS_TOKEN_TTL_MINUTES: '15',
      AUTH_REFRESH_TOKEN_TTL_DAYS: '30',
      AUTH_MAX_FAILED_LOGIN_ATTEMPTS: '5',
      AUTH_LOGIN_LOCK_MINUTES: '15',
      AUTH_REFRESH_COOKIE_NAME: 'phase30_refresh',
      AUTH_REFRESH_COOKIE_DOMAIN: '',
      AUTH_REFRESH_COOKIE_SECURE: 'false',
      AUTH_REFRESH_COOKIE_SAME_SITE: 'strict',
      AUTH_TRUSTED_PROXIES: '127.0.0.1,::1',
      THROTTLE_TTL: '60000',
      THROTTLE_LIMIT: '1000',
    });

    await waitForMySql(mysqlUri);
    deployDisposableMigrations(mysqlUri);
    await createApplication();
    const prisma = getApplication().get(PrismaService);
    if (!prisma.isConnected()) throw new Error('Disposable central database did not connect');

    platformUserId = randomUUID();
    platformSessionId = randomUUID();

    await seedControlPlane(prisma);
    const membershipValidator = getApplication().get(TenantMembershipValidatorService);
    const contextFactory = getApplication().get(TrustedTenantContextFactoryService);
    const authUser = {
      userId: platformUserId,
      sessionId: platformSessionId,
      tokenVersion: 1,
      platformRoleIds: [],
    };
    contextA = contextFactory.fromValidatedMembership(
      await membershipValidator.validateMembership({
        authenticatedPlatformUser: authUser,
        tenantIdCandidate: tenantA.id,
      }),
    );
    contextB = contextFactory.fromValidatedMembership(
      await membershipValidator.validateMembership({
        authenticatedPlatformUser: authUser,
        tenantIdCandidate: tenantB.id,
      }),
    );
    accessToken = await getApplication().get(AccessTokenService).sign({
      sub: platformUserId,
      sessionId: platformSessionId,
      tokenVersion: 1,
      platformRoleIds: [],
    });

    await provisionTenantTarget(tenantA);
    await provisionTenantTarget(tenantB);

    const placementsA = await getApplication()
      .get(TenantStorageRegistryService)
      .getPlacements(contextA);
    expect(placementsA).toHaveLength(1);
    expect(placementsA[0]?.placementId).toBe(targetA.id);
  }, 180_000);

  afterAll(async () => {
    try {
      if (application) {
        await application.close();
        application = undefined;
      }
      expect(mongoFactory.closeCount).toBe(mongoFactory.clients.length);
    } finally {
      if (mongoAdminClient) {
        await Promise.allSettled([
          mongoAdminClient.db(tenantA.databaseName).dropDatabase(),
          mongoAdminClient.db(tenantB.databaseName).dropDatabase(),
        ]);
        await mongoAdminClient.close().catch(() => undefined);
        mongoAdminClient = undefined;
      }
      await Promise.allSettled([mysqlContainer?.stop(), mongoContainer?.stop()]);
    }
  });

  it('runs authenticated Patient CRUD and lifecycle operations against real tenant databases', async () => {
    const health = await getApplication().inject({
      method: 'GET',
      url: `/${APP_CONSTANTS.apiPrefix}/health`,
    });
    const readiness = await getApplication().inject({
      method: 'GET',
      url: `/${APP_CONSTANTS.apiPrefix}/ready`,
    });
    expect(health.statusCode).toBe(200);
    expect(readiness.statusCode).toBe(200);

    const unauthenticated = await getApplication().inject({
      method: 'GET',
      url: `${tenantRoot(tenantA)}/patients`,
    });
    expect(unauthenticated.statusCode).toBe(401);

    const sharedNumber = 'PAT-300001';
    const patientAResponse = await getApplication().inject({
      method: 'POST',
      url: `${tenantRoot(tenantA)}/patients`,
      headers: bearerHeaders(),
      payload: patientPayload(sharedNumber),
    });
    const patientBResponse = await getApplication().inject({
      method: 'POST',
      url: `${tenantRoot(tenantB)}/patients`,
      headers: bearerHeaders(),
      payload: patientPayload(sharedNumber),
    });
    expect(patientAResponse.statusCode).toBe(201);
    expect(patientBResponse.statusCode).toBe(201);

    const patientA = patientAResponse.json<{ id: string; patientNumber: string }>();
    const patientB = patientBResponse.json<{ id: string; patientNumber: string }>();
    expect(patientA.id).not.toBe(patientB.id);

    const listA = await getApplication().inject({
      method: 'GET',
      url: `${tenantRoot(tenantA)}/patients?patientNumber=${sharedNumber}`,
      headers: bearerHeaders(),
    });
    const listB = await getApplication().inject({
      method: 'GET',
      url: `${tenantRoot(tenantB)}/patients?patientNumber=${sharedNumber}`,
      headers: bearerHeaders(),
    });
    expect(listA.statusCode).toBe(200);
    expect(listB.statusCode).toBe(200);
    expect(listA.json<{ items: Array<{ id: string }> }>().items.map(({ id }) => id)).toEqual([
      patientA.id,
    ]);
    expect(listB.json<{ items: Array<{ id: string }> }>().items.map(({ id }) => id)).toEqual([
      patientB.id,
    ]);

    const duplicate = await getApplication().inject({
      method: 'POST',
      url: `${tenantRoot(tenantA)}/patients`,
      headers: bearerHeaders(),
      payload: patientPayload(sharedNumber),
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ error: { code: 'PATIENT_NUMBER_CONFLICT' } });

    const update = await getApplication().inject({
      method: 'PATCH',
      url: `${tenantRoot(tenantA)}/patients/${patientA.id}`,
      headers: bearerHeaders(),
      payload: { preferredName: 'Verified' },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json()).toMatchObject({ id: patientA.id, preferredName: 'Verified' });

    const deactivate = await getApplication().inject({
      method: 'POST',
      url: `${tenantRoot(tenantA)}/patients/${patientA.id}/deactivate`,
      headers: bearerHeaders(),
    });
    expect(deactivate.statusCode).toBe(200);
    expect(deactivate.json()).toMatchObject({ id: patientA.id, status: 'INACTIVE' });

    const activate = await getApplication().inject({
      method: 'POST',
      url: `${tenantRoot(tenantA)}/patients/${patientA.id}/activate`,
      headers: bearerHeaders(),
    });
    expect(activate.statusCode).toBe(200);
    expect(activate.json()).toMatchObject({ id: patientA.id, status: 'ACTIVE' });

    const publicResponses = JSON.stringify([
      patientAResponse.json(),
      patientBResponse.json(),
      listA.json(),
      update.json(),
      deactivate.json(),
      activate.json(),
    ]);
    expect(publicResponses).not.toMatch(/databaseName|connectionReference|mongo(?:db)?|tenantId/i);

    const storedA = await mongoAdminClient!
      .db(tenantA.databaseName)
      .collection(PATIENT_COLLECTION)
      .findOne({ _id: patientA.id });
    const storedB = await mongoAdminClient!
      .db(tenantB.databaseName)
      .collection(PATIENT_COLLECTION)
      .findOne({ _id: patientB.id });
    expect(storedA?._tenantId).toBe(tenantA.id);
    expect(storedB?._tenantId).toBe(tenantB.id);

    const indexes = await mongoAdminClient!
      .db(tenantA.databaseName)
      .collection(PATIENT_COLLECTION)
      .indexes();
    const uniquePatientNumberIndex = indexes.find(
      ({ name }) => name === 'tenant_patient_number_unique',
    );
    expect(uniquePatientNumberIndex).toMatchObject({
      unique: true,
      key: { _tenantId: 1, patientNumber: 1 },
    });
    expect(indexes.map(({ name }) => name)).toEqual(
      expect.arrayContaining(['tenant_patient_status_created_idx', 'tenant_patient_created_idx']),
    );

    const auditRows = await getApplication()
      .get(PrismaService)
      .platformAuditLog.count({
        where: {
          subjectTenantId: tenantA.id,
          eventType: {
            in: [
              PlatformAuditEventType.PATIENT_CREATED,
              PlatformAuditEventType.PATIENT_UPDATED,
              PlatformAuditEventType.PATIENT_STATUS_CHANGED,
            ],
          },
        },
      });
    expect(auditRows).toBeGreaterThanOrEqual(4);
    expect(mongoFactory.clients).toHaveLength(1);
  });

  it('enforces tenant boundaries in HTTP, repository, and target resolution', async () => {
    const patientAResponse = await getApplication().inject({
      method: 'POST',
      url: `${tenantRoot(tenantA)}/patients`,
      headers: bearerHeaders(),
      payload: patientPayload('PAT-300002'),
    });
    const patientBResponse = await getApplication().inject({
      method: 'POST',
      url: `${tenantRoot(tenantB)}/patients`,
      headers: bearerHeaders(),
      payload: patientPayload('PAT-300003'),
    });
    expect(patientAResponse.statusCode).toBe(201);
    expect(patientBResponse.statusCode).toBe(201);
    const patientA = patientAResponse.json<{ id: string }>();
    const patientB = patientBResponse.json<{ id: string }>();

    const crossTenantRead = await getApplication().inject({
      method: 'GET',
      url: `${tenantRoot(tenantA)}/patients/${patientB.id}`,
      headers: bearerHeaders(),
    });
    expect(crossTenantRead.statusCode).toBe(404);
    expect(
      await getApplication()
        .get(TenantStoragePatientRepository)
        .findByIdForTenant(contextA, patientB.id),
    ).toBeNull();

    const reverseCrossTenantRead = await getApplication().inject({
      method: 'GET',
      url: `${tenantRoot(tenantB)}/patients/${patientA.id}`,
      headers: bearerHeaders(),
    });
    expect(reverseCrossTenantRead.statusCode).toBe(404);
    expect(
      await getApplication()
        .get(TenantStoragePatientRepository)
        .findByIdForTenant(contextB, patientA.id),
    ).toBeNull();

    const targetBForRoute = await getApplication()
      .get(TenantStorageRegistryService)
      .findActivePrimaryTarget(contextB, targetB.id);
    expect(targetBForRoute).not.toBeNull();
    const routeB: TenantStorageRoute = {
      placements: [{ placementId: targetB.id as TenantStoragePlacementId }],
    };
    await expect(
      getApplication().get(MongoTenantPatientStorage).findById(contextA, routeB, patientA.id),
    ).rejects.toBeInstanceOf(TenantStorageNotConfiguredError);

    expect(mongoFactory.clients).toHaveLength(1);
  });

  it('uses central membership permissions and fails closed for inactive, malformed, and missing targets', async () => {
    const prisma = getApplication().get(PrismaService);
    const rolePermission = {
      tenantRoleId: tenantA.roleId,
      tenantPermissionId: managePermissionId,
    };
    await prisma.tenantRolePermission.delete({
      where: { tenantRoleId_tenantPermissionId: rolePermission },
    });
    try {
      const denied = await getApplication().inject({
        method: 'POST',
        url: `${tenantRoot(tenantA)}/patients`,
        headers: bearerHeaders(),
        payload: patientPayload('PAT-300004'),
      });
      expect(denied.statusCode).toBe(403);
    } finally {
      await prisma.tenantRolePermission.create({ data: rolePermission });
    }

    const registry = getApplication().get(TenantStorageRegistryService);
    try {
      await registry.setTargetStatus(tenantA.id, targetA.id, TenantStorageTargetStatus.INACTIVE);
      const inactive = await getApplication().inject({
        method: 'GET',
        url: `${tenantRoot(tenantA)}/patients`,
        headers: bearerHeaders(),
      });
      expect(inactive.statusCode).toBe(503);
      expect(inactive.json()).toMatchObject({ error: { code: 'TENANT_STORAGE_NOT_CONFIGURED' } });

      await registry.setTargetStatus(tenantA.id, targetA.id, TenantStorageTargetStatus.ACTIVE);
      await prisma.tenantStorageTarget.update({
        where: { id: targetA.id },
        data: { databaseName: 'admin' },
      });
      const malformed = await getApplication().inject({
        method: 'GET',
        url: `${tenantRoot(tenantA)}/patients`,
        headers: bearerHeaders(),
      });
      expect(malformed.statusCode).toBe(503);
      expect(malformed.json()).toMatchObject({ error: { code: 'TENANT_STORAGE_NOT_CONFIGURED' } });
      expect(JSON.stringify(malformed.json())).not.toContain('admin');

      await prisma.tenantStorageTarget.delete({ where: { id: targetA.id } });
      const missing = await getApplication().inject({
        method: 'GET',
        url: `${tenantRoot(tenantA)}/patients`,
        headers: bearerHeaders(),
      });
      expect(missing.statusCode).toBe(503);
      expect(missing.json()).toMatchObject({ error: { code: 'TENANT_STORAGE_NOT_CONFIGURED' } });
    } finally {
      await restorePrimaryTargetA();
    }
  });

  it('fails closed for Mongo authentication, invalid configuration, and unavailable servers', async () => {
    expect(getApplication().get(TENANT_PATIENT_STORAGE)).toBeInstanceOf(MongoTenantPatientStorage);
    const invalidMongoUri = mongoUri.replace(mongoPassword, `${mongoPassword}incorrect`);
    const authFailure = await patientListFailureForMongoUri(invalidMongoUri);
    const invalidConfigUri = 'not-a-mongodb-uri';
    const invalidConfigFailure = await patientListFailureForMongoUri(invalidConfigUri);
    const unavailableFailure = await patientListFailureForMongoUri(
      'mongodb://127.0.0.1:1/?directConnection=true',
    );

    for (const failure of [authFailure, invalidConfigFailure, unavailableFailure]) {
      expect(failure).toBeInstanceOf(TenantStorageUnavailableError);
      expect(JSON.stringify(failure.getResponse())).toContain('TENANT_STORAGE_UNAVAILABLE');
    }
    expect(JSON.stringify(authFailure.getResponse())).not.toContain(mongoPassword);
    expect(JSON.stringify(authFailure.getResponse())).not.toContain(invalidMongoUri);
    expect(JSON.stringify(invalidConfigFailure.getResponse())).not.toContain(invalidConfigUri);
  });

  it('verifies Phase 31 directory search, filters, pagination, privacy, and number lookup against MongoDB', async () => {
    const sharedPatientNumber = `PAT31-NUM${RUN_ID}-SHARED`;
    const firstName = `FirstDir${RUN_ID}`;
    const middleName = `MiddleDir${RUN_ID}`;
    const lastName = `LastDir${RUN_ID}`;
    const preferredName = 'PreferredDir.*[x]';

    const createAt = async (
      tenant: TestTenant,
      payload: Record<string, unknown>,
    ): Promise<{ id: string; patientNumber: string }> => {
      const response = await getApplication().inject({
        method: 'POST',
        url: `${tenantRoot(tenant)}/patients`,
        headers: bearerHeaders(),
        payload,
      });
      expect(response.statusCode).toBe(201);
      return response.json<{ id: string; patientNumber: string }>();
    };
    const list = (tenant: TestTenant, query = ''): ReturnType<NestFastifyApplication['inject']> =>
      getApplication().inject({
        method: 'GET',
        url: `${tenantRoot(tenant)}/patients${query}`,
        headers: bearerHeaders(),
      });

    const patientA = await createAt(tenantA, {
      ...patientPayload(sharedPatientNumber),
      firstName,
      middleName,
      lastName,
      preferredName,
      phone: '+966500123456',
      email: `emaildir-${RUN_ID}@example.test`,
      nationalId: `NID-ONLY-${RUN_ID}`,
      address: `AddressOnly-${RUN_ID}`,
    });
    const patientB = await createAt(tenantB, {
      ...patientPayload(sharedPatientNumber),
      firstName,
      middleName,
      lastName,
      preferredName,
      phone: '+966501234567',
      email: `b-emaildir-${RUN_ID}@example.test`,
      nationalId: `B-NID-ONLY-${RUN_ID}`,
      address: `B-AddressOnly-${RUN_ID}`,
    });

    for (const search of [
      `num${RUN_ID.toLowerCase()}`,
      'firstdir',
      `MIDDLEDIR${RUN_ID.toUpperCase()}`,
      'lastdir',
      '.*[x]',
      '500123',
      `EMAILDIR-${RUN_ID.toUpperCase()}`,
    ]) {
      const response = await list(tenantA, `?search=${encodeURIComponent(search)}`);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        total: 1,
        items: [{ id: patientA.id }],
      });
    }

    const directory = await list(tenantA, `?search=${encodeURIComponent('firstdir')}`);
    const directoryEntry = directory.json<{
      items: Array<Record<string, unknown>>;
    }>().items[0];
    expect(directoryEntry).toMatchObject({
      id: patientA.id,
      patientNumber: sharedPatientNumber,
      firstName,
      middleName,
      lastName,
      preferredName,
      phone: '+966500123456',
      email: `emaildir-${RUN_ID}@example.test`,
    });
    for (const privateOrDetailField of [
      'nationalId',
      'address',
      'dateOfBirth',
      'gender',
      'createdAt',
      'updatedAt',
      '_id',
      '_tenantId',
      'tenantId',
      'databaseName',
      'connectionReference',
    ]) {
      expect(directoryEntry).not.toHaveProperty(privateOrDetailField);
    }

    const sensitiveFieldSearches = [`NID-ONLY-${RUN_ID}`, `AddressOnly-${RUN_ID}`];
    for (const search of sensitiveFieldSearches) {
      const response = await list(tenantA, `?search=${encodeURIComponent(search)}`);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ items: [], total: 0, hasNext: false });
    }
    const rawRegexPatternSearch = await list(tenantA, `?search=${encodeURIComponent('.+dir')}`);
    expect(rawRegexPatternSearch.statusCode).toBe(200);
    expect(rawRegexPatternSearch.json()).toMatchObject({ items: [], total: 0, hasNext: false });

    const tenantBNameSearch = await list(tenantB, `?search=${encodeURIComponent('firstdir')}`);
    expect(tenantBNameSearch.json()).toMatchObject({
      total: 1,
      items: [{ id: patientB.id }],
    });

    const byNumberA = await getApplication().inject({
      method: 'GET',
      url: `${tenantRoot(tenantA)}/patients/by-number/${encodeURIComponent(sharedPatientNumber)}`,
      headers: bearerHeaders(),
    });
    const byNumberB = await getApplication().inject({
      method: 'GET',
      url: `${tenantRoot(tenantB)}/patients/by-number/${encodeURIComponent(sharedPatientNumber)}`,
      headers: bearerHeaders(),
    });
    expect(byNumberA.statusCode).toBe(200);
    expect(byNumberB.statusCode).toBe(200);
    expect(byNumberA.json()).toMatchObject({ id: patientA.id, patientNumber: sharedPatientNumber });
    expect(byNumberB.json()).toMatchObject({ id: patientB.id, patientNumber: sharedPatientNumber });
    expect(byNumberA.json()).toHaveProperty('nationalId', `NID-ONLY-${RUN_ID}`);
    expect(byNumberA.json()).toHaveProperty('address', `AddressOnly-${RUN_ID}`);

    const patientNumberOnlyInA = `PAT31-ONLYA-${RUN_ID}`;
    await createAt(tenantA, patientPayload(patientNumberOnlyInA));
    const crossTenantNumberLookup = await getApplication().inject({
      method: 'GET',
      url: `${tenantRoot(tenantB)}/patients/by-number/${encodeURIComponent(patientNumberOnlyInA)}`,
      headers: bearerHeaders(),
    });
    const nonexistentNumberLookup = await getApplication().inject({
      method: 'GET',
      url: `${tenantRoot(tenantB)}/patients/by-number/NO-SUCH-${RUN_ID}`,
      headers: bearerHeaders(),
    });
    const crossTenantIdLookup = await getApplication().inject({
      method: 'GET',
      url: `${tenantRoot(tenantB)}/patients/${patientA.id}`,
      headers: bearerHeaders(),
    });
    expect(crossTenantNumberLookup.statusCode).toBe(404);
    expect(nonexistentNumberLookup.statusCode).toBe(404);
    expect(crossTenantIdLookup.statusCode).toBe(404);
    expect(crossTenantNumberLookup.json<{ error: unknown }>().error).toEqual(
      nonexistentNumberLookup.json<{ error: unknown }>().error,
    );
    expect(crossTenantIdLookup.json<{ error: unknown }>().error).toEqual(
      nonexistentNumberLookup.json<{ error: unknown }>().error,
    );

    const lowercaseNumberLookup = await getApplication().inject({
      method: 'GET',
      url: `${tenantRoot(tenantA)}/patients/by-number/${encodeURIComponent(
        sharedPatientNumber.toLowerCase(),
      )}`,
      headers: bearerHeaders(),
    });
    expect(lowercaseNumberLookup.statusCode).toBe(404);

    const activeBeforeDeactivation = await list(
      tenantA,
      `?search=${encodeURIComponent('firstdir')}&status=ACTIVE`,
    );
    expect(activeBeforeDeactivation.json()).toMatchObject({
      total: 1,
      items: [{ id: patientA.id, status: 'ACTIVE' }],
      hasNext: false,
    });

    const deactivate = await getApplication().inject({
      method: 'POST',
      url: `${tenantRoot(tenantA)}/patients/${patientA.id}/deactivate`,
      headers: bearerHeaders(),
    });
    expect(deactivate.statusCode).toBe(200);
    const inactiveSearch = await list(
      tenantA,
      `?search=${encodeURIComponent('firstdir')}&status=INACTIVE`,
    );
    const activeSearch = await list(
      tenantA,
      `?search=${encodeURIComponent('firstdir')}&status=ACTIVE`,
    );
    expect(inactiveSearch.json()).toMatchObject({
      total: 1,
      items: [{ id: patientA.id, status: 'INACTIVE' }],
      hasNext: false,
    });
    expect(activeSearch.json()).toMatchObject({ items: [], total: 0, hasNext: false });

    await createAt(tenantA, {
      ...patientPayload(`PAT31-PAGE1-${RUN_ID}`),
      firstName: `PagingMarker${RUN_ID}`,
      lastName: 'Pagination',
    });
    await createAt(tenantA, {
      ...patientPayload(`PAT31-PAGE2-${RUN_ID}`),
      firstName: `PagingMarker${RUN_ID}`,
      lastName: 'Pagination',
      dateOfBirth: '1991-01-01',
    });
    const page0Url = `?search=PagingMarker&limit=1&offset=0`;
    const page0 = await list(tenantA, page0Url);
    const page0Repeat = await list(tenantA, page0Url);
    const page1 = await list(tenantA, '?search=PagingMarker&limit=1&offset=1');
    const beyondTotal = await list(tenantA, '?search=PagingMarker&limit=1&offset=10');
    expect(page0.json()).toMatchObject({ total: 2, limit: 1, offset: 0, hasNext: true });
    expect(page1.json()).toMatchObject({ total: 2, limit: 1, offset: 1, hasNext: false });
    expect(beyondTotal.json()).toMatchObject({
      items: [],
      total: 2,
      limit: 1,
      offset: 10,
      hasNext: false,
    });
    expect(page0.json().items.map(({ id }: { id: string }) => id)).toEqual(
      page0Repeat.json().items.map(({ id }: { id: string }) => id),
    );

    const emptySearch = await list(tenantA, '?search=%20%20');
    const noSearch = await list(tenantA);
    expect(emptySearch.statusCode).toBe(200);
    expect(emptySearch.json().items.map(({ id }: { id: string }) => id)).toEqual(
      noSearch.json().items.map(({ id }: { id: string }) => id),
    );
    expect(emptySearch.json()).toMatchObject({ total: noSearch.json().total, offset: 0 });

    const noMatch = await list(tenantA, `?search=NoMatch-${RUN_ID}`);
    expect(noMatch.json()).toMatchObject({ items: [], total: 0, hasNext: false });
    const maximumSearch = await list(tenantA, `?search=${'x'.repeat(100)}`);
    const oversizedSearch = await list(tenantA, `?search=${'x'.repeat(101)}`);
    expect(maximumSearch.statusCode).toBe(200);
    expect(maximumSearch.json()).toMatchObject({ items: [], total: 0 });
    expect(oversizedSearch.statusCode).toBe(400);

    const rawOperatorObject = await list(tenantA, '?search%5B%24regex%5D=.%2A');
    const arbitraryFilter = await list(tenantA, '?filter%5B%24where%5D=true');
    const arbitrarySort = await list(tenantA, '?sort=patientNumber');
    const arbitraryProjection = await list(tenantA, '?projection=nationalId');
    expect(rawOperatorObject.statusCode).toBe(400);
    expect(arbitraryFilter.statusCode).toBe(400);
    expect(arbitrarySort.statusCode).toBe(400);
    expect(arbitraryProjection.statusCode).toBe(400);
  });

  it('verifies Phase 32 deterministic duplicate prevention and indexes against MongoDB', async () => {
    const firstName = `DupFirst${RUN_ID}`;
    const middleName = 'Dup Middle';
    const lastName = `DupLast-${RUN_ID}`;
    const phone = '+966 50 123 4567';
    const email = `duplicate-${RUN_ID}@example.test`;
    const baseIdentity = {
      firstName,
      middleName,
      lastName,
      dateOfBirth: '1990-06-15',
      phone,
      email,
    };

    const createPatient = (
      tenant: TestTenant,
      patientNumber: string,
      demographics: Record<string, unknown>,
    ): ReturnType<NestFastifyApplication['inject']> =>
      getApplication().inject({
        method: 'POST',
        url: `${tenantRoot(tenant)}/patients`,
        headers: bearerHeaders(),
        payload: { patientNumber, ...demographics },
      });

    const original = await createPatient(tenantA, `PAT32-SHARED-${RUN_ID}`, baseIdentity);
    expect(original.statusCode).toBe(201);
    const originalPatient = original.json<{ id: string; patientNumber: string }>();

    const phoneAndNameDuplicate = await createPatient(tenantA, `PAT32-PHONE-${RUN_ID}`, {
      firstName: firstName.toUpperCase(),
      middleName: ` ${middleName.toUpperCase()} `,
      lastName: lastName.toUpperCase(),
      phone: '+966  50   123 4567',
    });
    expect(phoneAndNameDuplicate.statusCode).toBe(409);
    expect(phoneAndNameDuplicate.json()).toMatchObject({
      error: {
        code: 'PATIENT_DUPLICATE_POSSIBLE',
        message: 'A possible matching patient already exists.',
      },
    });
    expect(JSON.stringify(phoneAndNameDuplicate.json())).not.toMatch(
      /patientNumber|patientId|firstName|lastName|phone|email|nationalId|address|databaseName/i,
    );

    const emailAndNameDuplicate = await createPatient(tenantA, `PAT32-EMAIL-${RUN_ID}`, {
      firstName,
      middleName,
      lastName,
      email: email.toUpperCase(),
    });
    expect(emailAndNameDuplicate.statusCode).toBe(409);
    expect(emailAndNameDuplicate.json()).toMatchObject({
      error: { code: 'PATIENT_DUPLICATE_POSSIBLE' },
    });

    const nameAndDateDuplicate = await createPatient(tenantA, `PAT32-DOB-${RUN_ID}`, {
      firstName: firstName.toUpperCase(),
      middleName: 'Different Middle',
      lastName: lastName.toUpperCase(),
      dateOfBirth: '1990-06-15',
    });
    expect(nameAndDateDuplicate.statusCode).toBe(409);
    expect(nameAndDateDuplicate.json()).toMatchObject({
      error: { code: 'PATIENT_DUPLICATE_POSSIBLE' },
    });

    const samePhoneOnly = await createPatient(tenantA, `PAT32-WEAK-PHONE-${RUN_ID}`, {
      firstName: 'Different',
      lastName: 'Person',
      phone,
    });
    const sameEmailOnly = await createPatient(tenantA, `PAT32-WEAK-EMAIL-${RUN_ID}`, {
      firstName: 'Another',
      lastName: 'Person',
      email,
    });
    const punctuationIsSignificant = await createPatient(tenantA, `PAT32-PHONE-PUNCT-${RUN_ID}`, {
      firstName,
      middleName,
      lastName,
      phone: '+966501234567',
    });
    const sameNameWithoutContactOrDate = await createPatient(tenantA, `PAT32-WEAK-NAME-${RUN_ID}`, {
      firstName,
      lastName,
    });
    expect(samePhoneOnly.statusCode).toBe(201);
    expect(sameEmailOnly.statusCode).toBe(201);
    expect(punctuationIsSignificant.statusCode).toBe(201);
    expect(sameNameWithoutContactOrDate.statusCode).toBe(201);

    const crossTenantIdentity = await createPatient(
      tenantB,
      originalPatient.patientNumber,
      baseIdentity,
    );
    expect(crossTenantIdentity.statusCode).toBe(201);
    expect(crossTenantIdentity.json<{ id: string }>().id).not.toBe(originalPatient.id);

    const selfUpdate = await getApplication().inject({
      method: 'PATCH',
      url: `${tenantRoot(tenantA)}/patients/${originalPatient.id}`,
      headers: bearerHeaders(),
      payload: { phone },
    });
    expect(selfUpdate.statusCode).toBe(200);

    const updateCandidate = await createPatient(tenantA, `PAT32-UPDATE-${RUN_ID}`, {
      firstName: 'Update',
      middleName: null,
      lastName: 'Candidate',
      phone: '+966 50 999 0000',
    });
    expect(updateCandidate.statusCode).toBe(201);
    const updateCandidateId = updateCandidate.json<{ id: string }>().id;
    const duplicateUpdate = await getApplication().inject({
      method: 'PATCH',
      url: `${tenantRoot(tenantA)}/patients/${updateCandidateId}`,
      headers: bearerHeaders(),
      payload: { firstName, middleName, lastName, phone },
    });
    expect(duplicateUpdate.statusCode).toBe(409);
    expect(duplicateUpdate.json()).toMatchObject({
      error: phoneAndNameDuplicate.json<{ error: unknown }>().error,
    });

    const unchangedAfterRejection = await getApplication().inject({
      method: 'GET',
      url: `${tenantRoot(tenantA)}/patients/${updateCandidateId}`,
      headers: bearerHeaders(),
    });
    expect(unchangedAfterRejection.json()).toMatchObject({
      id: updateCandidateId,
      firstName: 'Update',
      lastName: 'Candidate',
      phone: '+966 50 999 0000',
    });

    const dateUpdateCandidate = await createPatient(tenantA, `PAT32-DATE-UPDATE-${RUN_ID}`, {
      firstName: 'Date',
      middleName: null,
      lastName: 'Candidate',
      dateOfBirth: '1980-06-15',
    });
    expect(dateUpdateCandidate.statusCode).toBe(201);
    const dateUpdateCandidateId = dateUpdateCandidate.json<{ id: string }>().id;
    const duplicateDateUpdate = await getApplication().inject({
      method: 'PATCH',
      url: `${tenantRoot(tenantA)}/patients/${dateUpdateCandidateId}`,
      headers: bearerHeaders(),
      payload: { firstName, middleName: 'Different Middle', lastName, dateOfBirth: '1990-06-15' },
    });
    expect(duplicateDateUpdate.statusCode).toBe(409);
    expect(duplicateDateUpdate.json()).toMatchObject({
      error: { code: 'PATIENT_DUPLICATE_POSSIBLE' },
    });

    const patients = mongoAdminClient!.db(tenantA.databaseName).collection(PATIENT_COLLECTION);
    const storedOriginal = await patients.findOne({ _id: originalPatient.id });
    expect(storedOriginal).toMatchObject({
      firstName,
      middleName,
      lastName,
      phone,
      email,
    });
    expect(storedOriginal).not.toHaveProperty('normalizedPhone');
    expect(storedOriginal).not.toHaveProperty('normalizedEmail');
    expect(storedOriginal).not.toHaveProperty('normalizedName');

    const duplicateIndexes = await patients.indexes();
    const duplicateIndexNames = [
      'tenant_patient_duplicate_phone_name_idx',
      'tenant_patient_duplicate_email_name_idx',
      'tenant_patient_duplicate_name_dob_idx',
    ];
    for (const name of duplicateIndexNames) {
      expect(duplicateIndexes.find((index) => index.name === name)?.collation).toMatchObject({
        locale: 'en',
        strength: 2,
      });
    }

    const phonePlan = await patients
      .find({
        _tenantId: tenantA.id,
        phone,
        firstName: firstName.toLowerCase(),
        middleName: middleName.toLowerCase(),
        lastName: lastName.toLowerCase(),
      })
      .collation({ locale: 'en', strength: 2 })
      .hint(duplicateIndexNames[0]!)
      .limit(1)
      .explain('queryPlanner');
    expect(JSON.stringify(phonePlan.queryPlanner.winningPlan)).toContain(duplicateIndexNames[0]);

    const emailPlan = await patients
      .find({
        _tenantId: tenantA.id,
        email,
        firstName: firstName.toLowerCase(),
        middleName: middleName.toLowerCase(),
        lastName: lastName.toLowerCase(),
      })
      .collation({ locale: 'en', strength: 2 })
      .hint(duplicateIndexNames[1]!)
      .limit(1)
      .explain('queryPlanner');
    expect(JSON.stringify(emailPlan.queryPlanner.winningPlan)).toContain(duplicateIndexNames[1]);

    const dateStart = new Date('1990-06-15T00:00:00.000Z');
    const datePlan = await patients
      .find({
        _tenantId: tenantA.id,
        firstName: firstName.toLowerCase(),
        lastName: lastName.toLowerCase(),
        dateOfBirth: { $gte: dateStart, $lt: new Date('1990-06-16T00:00:00.000Z') },
      })
      .collation({ locale: 'en', strength: 2 })
      .hint(duplicateIndexNames[2]!)
      .limit(1)
      .explain('queryPlanner');
    expect(JSON.stringify(datePlan.queryPlanner.winningPlan)).toContain(duplicateIndexNames[2]);
  });

  it('preserves records after application shutdown and a fresh Nest app/repository is created', async () => {
    const patientNumber = 'PAT-300005';
    const create = await getApplication().inject({
      method: 'POST',
      url: `${tenantRoot(tenantA)}/patients`,
      headers: bearerHeaders(),
      payload: patientPayload(patientNumber),
    });
    expect(create.statusCode).toBe(201);
    const createdPatient = create.json<{ id: string; patientNumber: string }>();
    const priorClientCount = mongoFactory.clients.length;
    expect(priorClientCount).toBe(1);

    await closeApplication();
    expect(mongoFactory.closeCount).toBe(priorClientCount);
    await createApplication();

    const recreatedServiceRead = await getApplication()
      .get(PatientService)
      .findById(contextA, createdPatient.id);
    expect(recreatedServiceRead).toMatchObject({
      id: createdPatient.id,
      patientNumber,
    });

    const httpRead = await getApplication().inject({
      method: 'GET',
      url: `${tenantRoot(tenantA)}/patients/${createdPatient.id}`,
      headers: bearerHeaders(),
    });
    expect(httpRead.statusCode).toBe(200);
    expect(httpRead.json()).toMatchObject(createdPatient);
    expect(mongoFactory.clients).toHaveLength(priorClientCount + 1);
  });
});

async function patientListFailureForMongoUri(uri: string): Promise<TenantStorageUnavailableError> {
  const manager = new TenantMongoClientManager(
    { tenantStorageMongoUri: uri } as unknown as ConfigService,
    new OfficialTenantMongoClientFactory(),
  );
  const storage = new MongoTenantPatientStorage(
    getApplication().get(TenantStorageRegistryService),
    manager,
  );
  const repository = new TenantStoragePatientRepository(
    getApplication().get(TenantStorageResolverService),
    storage,
  );

  try {
    await repository.list(contextA, { limit: 10, offset: 0 });
  } catch (error) {
    if (error instanceof TenantStorageUnavailableError) return error;
    throw error;
  } finally {
    await manager.onApplicationShutdown();
  }

  throw new Error('Expected Patient storage to fail closed');
}

function createTestTenant(suffix: string): TestTenant {
  const slug = `phase30-${RUN_ID}-${suffix}`;
  return {
    id: randomUUID(),
    membershipId: randomUUID(),
    roleId: randomUUID(),
    databaseName: `phase30_${RUN_ID}_${suffix}`,
    slug,
  };
}

function getApplication(): NestFastifyApplication {
  if (!application) throw new Error('Phase 30 test application is not running');
  return application;
}

async function createApplication(): Promise<void> {
  const { AppModule } = requireFromWorkspace('../dist/app.module');
  const testingModule: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(TENANT_MONGO_CLIENT_FACTORY)
    .useValue(mongoFactory)
    .compile();
  application = testingModule.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  application.setGlobalPrefix(APP_CONSTANTS.apiPrefix);
  application.enableShutdownHooks();
  await application.init();
  await application.getHttpAdapter().getInstance().ready();
}

async function closeApplication(): Promise<void> {
  const current = application;
  application = undefined;
  if (current) await current.close();
}

async function seedControlPlane(prisma: PrismaService): Promise<void> {
  const now = new Date();
  await prisma.user.create({
    data: {
      id: platformUserId,
      email: `phase30-${RUN_ID}@example.test`,
      passwordHash: randomBytes(32).toString('hex'),
      fullName: 'Phase 30 Integration Test',
      status: UserStatus.ACTIVE,
      tokenVersion: 1,
    },
  });

  await prisma.platformSession.create({
    data: {
      id: platformSessionId,
      userId: platformUserId,
      refreshTokenHash: randomBytes(32).toString('hex'),
      tokenFamilyId: randomUUID(),
      status: PlatformSessionStatus.ACTIVE,
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    },
  });

  for (const tenant of [tenantA, tenantB]) {
    await prisma.tenant.create({
      data: {
        id: tenant.id,
        slug: tenant.slug,
        legalName: `Phase 30 ${tenant.slug}`,
        displayName: `Phase 30 ${tenant.slug}`,
        status: TenantStatus.ACTIVE,
      },
    });
    await prisma.tenantMembership.create({
      data: {
        id: tenant.membershipId,
        tenantId: tenant.id,
        platformUserId,
        status: TenantMembershipStatus.ACTIVE,
        activatedAt: now,
      },
    });
    await prisma.tenantRole.create({
      data: {
        id: tenant.roleId,
        tenantId: tenant.id,
        code: `PHASE30_${RUN_ID.toUpperCase()}`,
        name: 'Phase 30 integration role',
      },
    });
  }

  const readPermission = await prisma.tenantPermission.upsert({
    where: { code: 'tenant.patients.read' },
    create: {
      code: 'tenant.patients.read',
      description: 'Read Patients for Phase 30 integration verification',
    },
    update: {},
  });
  const managePermission = await prisma.tenantPermission.upsert({
    where: { code: 'tenant.patients.manage' },
    create: {
      code: 'tenant.patients.manage',
      description: 'Manage Patients for Phase 30 integration verification',
    },
    update: {},
  });
  readPermissionId = readPermission.id;
  managePermissionId = managePermission.id;

  for (const tenant of [tenantA, tenantB]) {
    await prisma.tenantRolePermission.createMany({
      data: [readPermissionId, managePermissionId].map((tenantPermissionId) => ({
        tenantRoleId: tenant.roleId,
        tenantPermissionId,
      })),
    });
    await prisma.tenantMembershipRole.create({
      data: {
        tenantId: tenant.id,
        membershipId: tenant.membershipId,
        tenantRoleId: tenant.roleId,
      },
    });
  }
}

async function provisionTenantTarget(tenant: TestTenant): Promise<void> {
  await mongoAdminClient!.db(tenant.databaseName).createCollection(PATIENT_COLLECTION);
  const registry = getApplication().get(TenantStorageRegistryService);
  const target = await registry.registerTarget(tenant.id, tenant.databaseName);
  await getApplication().get(MongoTenantPatientStorage).ensureIndexesForTarget(target);
  await registry.setTargetStatus(tenant.id, target.id, TenantStorageTargetStatus.ACTIVE);
  const primaryTarget = await registry.setPrimaryTarget(tenant.id, target.id);
  if (!primaryTarget) throw new Error('Could not activate the disposable tenant storage target');
  if (tenant === tenantA) targetA = primaryTarget;
  else targetB = primaryTarget;
}

async function restorePrimaryTargetA(): Promise<void> {
  const prisma = getApplication().get(PrismaService);
  const existing = await prisma.tenantStorageTarget.findFirst({
    where: { tenantId: tenantA.id, connectionReference: 'primary' },
  });
  if (existing) {
    targetA = await prisma.tenantStorageTarget.update({
      where: { id: existing.id },
      data: {
        databaseName: tenantA.databaseName,
        status: TenantStorageTargetStatus.ACTIVE,
        isPrimary: true,
      },
    });
    return;
  }
  await provisionTenantTarget(tenantA);
}

async function waitForMySql(uri: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const probe = new PrismaClient({
      datasources: { db: { url: uri } },
    });
    try {
      await probe.$connect();
      await probe.$queryRaw`SELECT 1`;
      return;
    } catch {
      await delay(500);
    } finally {
      await probe.$disconnect().catch(() => undefined);
    }
  }
  throw new Error('Disposable MySQL did not become ready');
}

function deployDisposableMigrations(uri: string): void {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'phase30-prisma-'));
  const temporaryPrismaDirectory = join(temporaryRoot, 'prisma');
  const sourcePrismaDirectory = resolve(process.cwd(), 'prisma');
  const sourceMigrationsDirectory = join(sourcePrismaDirectory, 'migrations');
  const temporaryMigrationsDirectory = join(temporaryPrismaDirectory, 'migrations');

  try {
    mkdirSync(temporaryMigrationsDirectory, { recursive: true });
    copyFileSync(
      join(sourcePrismaDirectory, 'schema.prisma'),
      join(temporaryPrismaDirectory, 'schema.prisma'),
    );

    for (const entry of readdirSync(sourceMigrationsDirectory, { withFileTypes: true })) {
      const sourcePath = join(sourceMigrationsDirectory, entry.name);
      if (!entry.isDirectory()) {
        if (!entry.isFile()) {
          throw new Error(`Unsupported entry in Prisma migrations: ${entry.name}`);
        }
        copyFileSync(sourcePath, join(temporaryMigrationsDirectory, entry.name));
        continue;
      }

      const files = readdirSync(sourcePath, { withFileTypes: true });
      if (files.length === 0) continue;
      if (!files.some((file) => file.isFile() && file.name === 'migration.sql')) {
        throw new Error(`Nonempty Prisma migration directory lacks migration.sql: ${entry.name}`);
      }

      const temporaryMigrationDirectory = join(temporaryMigrationsDirectory, entry.name);
      mkdirSync(temporaryMigrationDirectory);
      for (const file of files) {
        if (!file.isFile()) {
          throw new Error(`Unsupported entry in Prisma migration ${entry.name}: ${file.name}`);
        }
        copyFileSync(join(sourcePath, file.name), join(temporaryMigrationDirectory, file.name));
      }
    }

    execFileSync(
      process.execPath,
      [
        resolve(process.cwd(), 'node_modules/prisma/build/index.js'),
        'migrate',
        'deploy',
        '--schema',
        join(temporaryPrismaDirectory, 'schema.prisma'),
      ],
      {
        cwd: process.cwd(),
        env: {
          PATH: process.env.PATH ?? '/usr/bin:/bin',
          HOME: process.env.HOME ?? '/tmp',
          NODE_ENV: 'development',
          DATABASE_URL: uri,
          PRISMA_HIDE_UPDATE_MESSAGE: '1',
        },
        stdio: 'pipe',
        timeout: 120_000,
        maxBuffer: 8 * 1024 * 1024,
      },
    );
  } catch (error) {
    const diagnostic =
      error && typeof error === 'object' && 'stderr' in error
        ? String(error.stderr)
        : error instanceof Error
          ? error.message
          : String(error);
    const safeDiagnostic = diagnostic
      .replace(/mysql:\/\/[^@\s]+@/gi, 'mysql://[redacted]@')
      .slice(-3_000);
    throw new Error(`Disposable MySQL migrations did not complete: ${safeDiagnostic}`);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function tenantRoot(tenant: TestTenant): string {
  return `/${APP_CONSTANTS.apiPrefix}/v1/tenants/${tenant.id}`;
}

function bearerHeaders(): { authorization: string } {
  return { authorization: `Bearer ${accessToken}` };
}

function patientPayload(patientNumber: string): {
  patientNumber: string;
  firstName: string;
  middleName: null;
  lastName: string;
  dateOfBirth: string;
} {
  return {
    patientNumber,
    firstName: `Phase-${patientNumber}`,
    middleName: null,
    lastName: 'Thirty',
    dateOfBirth: '1990-01-01',
  };
}
