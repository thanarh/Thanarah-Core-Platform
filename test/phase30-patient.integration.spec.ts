import { randomBytes, randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { join, resolve } from 'node:path';
import {
  PlatformAuditEventType,
  PlatformSessionStatus,
  PrismaClient,
  FacilitySchedulingPolicyStatus,
  StaffStatus,
  TenantMembershipStatus,
  TenantStatus,
  TenantStorageTargetStatus,
  UserStatus,
} from '@prisma/client';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { Test, type TestingModule } from '@nestjs/testing';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { MongoClient, type Db, type Document } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConfigService } from '../dist/config/config.service';
import type { TenantMongoClientFactory } from '../dist/tenant/tenant-mongo-client.manager';
import type { TenantStorageTargetRecord } from '../dist/tenant/tenant-storage.registry';
import type { TrustedTenantContext } from '../dist/tenant/tenant-context.contract';
import type { EncounterHistoryEvent, EncounterRecord } from '../src/tenant/encounter.model';
import type {
  TenantStoragePlacementId,
  TenantStorageRoute,
} from '../dist/tenant/tenant-storage.contract';

const requireFromWorkspace = createRequire(
  resolve(process.cwd(), 'test/phase30-patient.integration.spec.ts'),
);
const { APP_CONSTANTS } = requireFromWorkspace('../dist/common/constants/app.constants');
const { PasswordHasherService } = requireFromWorkspace(
  '../dist/auth/security/password-hasher.service',
);
const { PrismaService } = requireFromWorkspace('../dist/database/prisma.service');
const { MongoTenantPatientStorage } = requireFromWorkspace(
  '../dist/tenant/mongo-tenant-patient.storage',
);
const { MongoTenantAppointmentStorage } = requireFromWorkspace(
  '../dist/tenant/mongo-tenant-appointment.storage',
);
const { MongoTenantEncounterStorage } = requireFromWorkspace(
  '../dist/tenant/mongo-tenant-encounter.storage',
);
const { EncounterAppointmentConflictError } = requireFromWorkspace(
  '../dist/tenant/encounter.errors',
);
const { FacilitySchedulingPolicyService } = requireFromWorkspace(
  '../dist/tenant/appointment-scheduling-policy.service',
);
const { AppointmentScheduleConflictError, AppointmentScheduleLockConflictError } =
  requireFromWorkspace('../dist/tenant/appointment.errors');
const { OfficialTenantMongoClientFactory, TENANT_MONGO_CLIENT_FACTORY, TenantMongoClientManager } =
  requireFromWorkspace('../dist/tenant/tenant-mongo-client.manager');
const { PatientService } = requireFromWorkspace('../dist/tenant/patient.service');
const { TenantStoragePatientRepository } = requireFromWorkspace(
  '../dist/tenant/patient.repository',
);
const { TenantStorageRegistryService } = requireFromWorkspace(
  '../dist/tenant/tenant-storage.registry',
);
const { TenantStorageActivationService } = requireFromWorkspace(
  '../dist/tenant/tenant-storage.activation.service',
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
let mysqlRootPassword = '';
let mysqlRootUri = '';
let accessToken = '';
let testEmail = '';
let testPassword = '';
let refreshCookie = '';
let browserBaseUrl = '';
let targetA: TenantStorageTargetRecord;
let targetB: TenantStorageTargetRecord;
let contextA: TrustedTenantContext;
let contextB: TrustedTenantContext;
let platformUserId = '';
let platformSessionId = '';
let readPermissionId = '';
let managePermissionId = '';
let clinicalFacilityId = '';
let clinicalBranchId = '';
let unassignedBranchId = '';
let clinicalDoctorId = '';
let clinicalServiceId = '';
let otherTenantDoctorId = '';
let otherTenantServiceId = '';
let clinicalPatientId = '';
let otherTenantPatientId = '';
let apiEncounterId = '';
let browserEncounterId = '';
let browserAppointmentId = '';
let limitedUserId = '';
let limitedUserEmail = '';
let limitedUserPassword = '';

describe('Real tenant MongoDB Patient and Appointment runtime verification', () => {
  beforeAll(async () => {
    if (process.env.DOCKER_HOST !== DOCKER_SOCKET) {
      throw new Error('Phase 30 requires the explicitly selected local Docker socket');
    }

    mongoPassword = randomBytes(24).toString('hex');
    mysqlPassword = randomBytes(24).toString('hex');
    mysqlRootPassword = randomBytes(24).toString('hex');

    mongoContainer = await new GenericContainer(MONGO_IMAGE)
      .withCommand(['mongod', '--setParameter', 'enableTestCommands=1'])
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
        MYSQL_ROOT_PASSWORD: mysqlRootPassword,
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
    mysqlRootUri = `mysql://root:${encodeURIComponent(mysqlRootPassword)}@${mysqlHost}:${mysqlPort}/${TEST_MYSQL_DATABASE}`;

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
    testEmail = `phase42-${RUN_ID}@example.test`;
    testPassword = randomBytes(24).toString('base64url');

    await seedControlPlane(prisma);
    await seedClinicalFixtures(prisma);
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
    const loginResponse = await getApplication().inject({
      method: 'POST',
      url: `/${APP_CONSTANTS.apiPrefix}/${APP_CONSTANTS.apiVersion}/auth/login`,
      payload: { email: testEmail, password: testPassword },
    });
    if (loginResponse.statusCode !== 200) {
      throw new Error(`Disposable user could not sign in: HTTP ${loginResponse.statusCode}`);
    }
    accessToken = loginResponse.json<{ accessToken: string }>().accessToken;
    refreshCookie = cookiePair(loginResponse.headers['set-cookie']);

    await provisionTenantTarget(tenantA);
    await provisionTenantTarget(tenantB);

    const placementsA = await getApplication()
      .get(TenantStorageRegistryService)
      .getPlacements(contextA);
    expect(placementsA).toHaveLength(1);
    expect(placementsA[0]?.placementId).toBe(targetA.id);
    await getApplication().listen(0, '127.0.0.1');
    const address = getApplication().getHttpAdapter().getInstance().server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Disposable HTTP server did not report its assigned address');
    }
    browserBaseUrl = `http://127.0.0.1:${address.port}`;
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

  it('uses real password sign-in, cookie refresh, and authenticated workspace permissions', async () => {
    const authRoot = `/${APP_CONSTANTS.apiPrefix}/${APP_CONSTANTS.apiVersion}/auth`;
    const badLogin = await getApplication().inject({
      method: 'POST',
      url: `${authRoot}/login`,
      payload: { email: testEmail, password: `${testPassword}-incorrect` },
    });
    expect(badLogin.statusCode).toBe(401);

    const login = await getApplication().inject({
      method: 'POST',
      url: `${authRoot}/login`,
      payload: { email: testEmail, password: testPassword },
    });
    expect(login.statusCode).toBe(200);
    accessToken = login.json<{ accessToken: string }>().accessToken;
    refreshCookie = cookiePair(login.headers['set-cookie']);
    expect(refreshCookie).toMatch(/^phase30_refresh=/u);
    expect(String(login.headers['set-cookie'])).toMatch(/HttpOnly/iu);

    const refresh = await getApplication().inject({
      method: 'POST',
      url: `${authRoot}/refresh`,
      headers: { cookie: refreshCookie },
    });
    expect(refresh.statusCode).toBe(200);
    const refreshedAccessToken = refresh.json<{ accessToken: string }>().accessToken;
    expect(refreshedAccessToken).toBeTruthy();
    const rotatedCookie = cookiePair(refresh.headers['set-cookie']);
    expect(rotatedCookie).not.toBe(refreshCookie);
    accessToken = refreshedAccessToken;
    refreshCookie = rotatedCookie;

    const workspaces = await getApplication().inject({
      method: 'GET',
      url: `/${APP_CONSTANTS.apiPrefix}/${APP_CONSTANTS.apiVersion}/session/tenants`,
      headers: bearerHeaders(),
    });
    expect(workspaces.statusCode).toBe(200);
    expect(
      workspaces.json<{ items: Array<{ tenantId: string; permissionCodes: string[] }> }>().items,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tenantId: tenantA.id,
          permissionCodes: expect.arrayContaining([
            'tenant.encounters.diagnoses.read',
            'tenant.encounters.services.write',
            'tenant.encounters.amendments.finalize',
          ]),
        }),
      ]),
    );
  });

  it('expires a real platform session and recovers through a fresh password sign-in', async () => {
    const authRoot = `/${APP_CONSTANTS.apiPrefix}/${APP_CONSTANTS.apiVersion}/auth`;
    const login = await getApplication().inject({
      method: 'POST',
      url: `${authRoot}/login`,
      payload: { email: testEmail, password: testPassword },
    });
    expect(login.statusCode).toBe(200);
    const expiredAccessToken = login.json<{ accessToken: string }>().accessToken;
    const expiredRefreshCookie = cookiePair(login.headers['set-cookie']);

    const prisma = getApplication().get(PrismaService);
    const session = await prisma.platformSession.findFirst({
      where: { userId: platformUserId, status: PlatformSessionStatus.ACTIVE },
      orderBy: { createdAt: 'desc' },
    });
    expect(session).not.toBeNull();
    await prisma.platformSession.update({
      where: { id: session!.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    const expiredAccess = await getApplication().inject({
      method: 'GET',
      url: `/${APP_CONSTANTS.apiPrefix}/${APP_CONSTANTS.apiVersion}/session/tenants`,
      headers: { authorization: `Bearer ${expiredAccessToken}` },
    });
    expect(expiredAccess.statusCode).toBe(401);
    const expiredRefresh = await getApplication().inject({
      method: 'POST',
      url: `${authRoot}/refresh`,
      headers: { cookie: expiredRefreshCookie },
    });
    expect(expiredRefresh.statusCode).toBe(401);

    const recoveryLogin = await getApplication().inject({
      method: 'POST',
      url: `${authRoot}/login`,
      payload: { email: testEmail, password: testPassword },
    });
    expect(recoveryLogin.statusCode).toBe(200);
    const recoveredWorkspaces = await getApplication().inject({
      method: 'GET',
      url: `/${APP_CONSTANTS.apiPrefix}/${APP_CONSTANTS.apiVersion}/session/tenants`,
      headers: {
        authorization: `Bearer ${recoveryLogin.json<{ accessToken: string }>().accessToken}`,
      },
    });
    expect(recoveredWorkspaces.statusCode).toBe(200);
  });

  it('enforces scoped encounter access and completes an audited amendment workflow in disposable databases', async () => {
    const unauthenticated = await getApplication().inject({
      method: 'GET',
      url: `${tenantRoot(tenantA)}/encounters`,
    });
    expect(unauthenticated.statusCode).toBe(401);

    const deniedTenant = await getApplication().inject({
      method: 'GET',
      url: `${tenantRoot(tenantB)}/encounters`,
      headers: bearerHeaders(),
    });
    expect(deniedTenant.statusCode).toBe(403);

    const patientResponse = await getApplication().inject({
      method: 'POST',
      url: `${tenantRoot(tenantA)}/patients`,
      headers: bearerHeaders(),
      payload: patientPayload(`P42-${RUN_ID}`),
    });
    expect(patientResponse.statusCode).toBe(201);
    clinicalPatientId = patientResponse.json<{ id: string }>().id;
    const otherTenantPatientResponse = await getApplication().inject({
      method: 'POST',
      url: `${tenantRoot(tenantB)}/patients`,
      headers: bearerHeaders(),
      payload: patientPayload(`P44-${RUN_ID}`),
    });
    expect(otherTenantPatientResponse.statusCode).toBe(201);
    otherTenantPatientId = otherTenantPatientResponse.json<{ id: string }>().id;

    const createEncounter = async (): Promise<{ id: string }> => {
      const response = await getApplication().inject({
        method: 'POST',
        url: `${tenantRoot(tenantA)}/encounters/direct`,
        headers: bearerHeaders(),
        payload: {
          patientId: clinicalPatientId,
          doctorId: clinicalDoctorId,
          facilityId: clinicalFacilityId,
          branchId: clinicalBranchId,
        },
      });
      expect(response.statusCode).toBe(201);
      return response.json<{ id: string }>();
    };
    const encounter = await createEncounter();
    apiEncounterId = encounter.id;
    browserEncounterId = (await createEncounter()).id;

    const deniedMutation = await getApplication().inject({
      method: 'PUT',
      url: `${tenantRoot(tenantB)}/encounters/${apiEncounterId}/diagnoses`,
      headers: bearerHeaders(),
      payload: { expectedVersion: 1, diagnoses: [] },
    });
    expect(deniedMutation.statusCode).toBe(403);

    const detail = await getApplication().inject({
      method: 'GET',
      url: `${tenantRoot(tenantA)}/encounters/${apiEncounterId}`,
      headers: bearerHeaders(),
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      id: apiEncounterId,
      status: 'DRAFT',
      currentRevision: 'ORIGINAL',
      diagnoses: [],
      serviceRecords: [],
    });

    const listed = await getApplication().inject({
      method: 'GET',
      url: `${tenantRoot(tenantA)}/encounters?facilityId=${clinicalFacilityId}&branchId=${clinicalBranchId}`,
      headers: bearerHeaders(),
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json<{ items: Array<{ id: string }> }>().items.map(({ id }) => id)).toContain(
      apiEncounterId,
    );

    const clinicDateParts = new Map(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Riyadh',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
        .formatToParts(new Date())
        .map(({ type, value }) => [type, value]),
    );
    const clinicDate = `${clinicDateParts.get('year')}-${clinicDateParts.get('month')}-${clinicDateParts.get('day')}`;
    const dateScopedList = await getApplication().inject({
      method: 'GET',
      url: `${tenantRoot(tenantA)}/encounters?facilityId=${clinicalFacilityId}&branchId=${clinicalBranchId}&fromDate=${clinicDate}&toDate=${clinicDate}`,
      headers: bearerHeaders(),
    });
    expect(dateScopedList.statusCode, dateScopedList.body).toBe(200);
    expect(
      dateScopedList.json<{ items: Array<{ id: string }> }>().items.map(({ id }) => id),
    ).toEqual(expect.arrayContaining([apiEncounterId, browserEncounterId]));

    const outOfScopeList = await getApplication().inject({
      method: 'GET',
      url: `${tenantRoot(tenantA)}/encounters?facilityId=${clinicalFacilityId}&branchId=${unassignedBranchId}`,
      headers: bearerHeaders(),
    });
    expect(outOfScopeList.statusCode).toBe(403);
    const outOfScopeCreate = await getApplication().inject({
      method: 'POST',
      url: `${tenantRoot(tenantA)}/encounters/direct`,
      headers: bearerHeaders(),
      payload: {
        patientId: clinicalPatientId,
        doctorId: clinicalDoctorId,
        facilityId: clinicalFacilityId,
        branchId: unassignedBranchId,
      },
    });
    expect(outOfScopeCreate.statusCode).toBe(403);

    const clinicalText = 'Phase 42 authenticated draft note';
    const clinicalUpdate = await getApplication().inject({
      method: 'PATCH',
      url: `${tenantRoot(tenantA)}/encounters/${apiEncounterId}/clinical`,
      headers: bearerHeaders(),
      payload: { expectedVersion: 1, clinical: { chiefComplaint: clinicalText } },
    });
    expect(clinicalUpdate.statusCode).toBe(200);
    expect(clinicalUpdate.json()).toMatchObject({
      version: 2,
      clinical: { chiefComplaint: clinicalText },
    });

    const diagnosisUpdate = await getApplication().inject({
      method: 'PUT',
      url: `${tenantRoot(tenantA)}/encounters/${apiEncounterId}/diagnoses`,
      headers: bearerHeaders(),
      payload: {
        expectedVersion: 2,
        diagnoses: [
          {
            description: 'Primary clinician-entered diagnosis',
            priority: 'PRIMARY',
            clinicalStatus: 'ACTIVE',
            onsetAt: '2026-10-16T00:00:00.000Z',
          },
        ],
      },
    });
    expect(diagnosisUpdate.statusCode, diagnosisUpdate.body).toBe(200);
    const primaryDiagnosisId = diagnosisUpdate.json<{ diagnoses: Array<{ id: string }> }>()
      .diagnoses[0]!.id;
    expect(
      (
        await getApplication().inject({
          method: 'PUT',
          url: `${tenantRoot(tenantA)}/encounters/${apiEncounterId}/diagnoses`,
          headers: bearerHeaders(),
          payload: {
            expectedVersion: 2,
            diagnoses: [
              {
                description: 'Primary clinician-entered diagnosis',
                priority: 'PRIMARY',
                clinicalStatus: 'ACTIVE',
              },
            ],
          },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await getApplication().inject({
          method: 'PUT',
          url: `${tenantRoot(tenantA)}/encounters/${apiEncounterId}/diagnoses`,
          headers: bearerHeaders(),
          payload: {
            expectedVersion: 3,
            diagnoses: [
              { description: 'One', priority: 'PRIMARY', clinicalStatus: 'ACTIVE' },
              { description: 'Two', priority: 'PRIMARY', clinicalStatus: 'ACTIVE' },
            ],
          },
        })
      ).statusCode,
    ).toBe(400);

    const foreignService = await getApplication().inject({
      method: 'PUT',
      url: `${tenantRoot(tenantA)}/encounters/${apiEncounterId}/services`,
      headers: bearerHeaders(),
      payload: {
        expectedVersion: 3,
        serviceRecords: [{ serviceId: otherTenantServiceId, providerDoctorId: clinicalDoctorId }],
      },
    });
    expect(foreignService.statusCode).toBe(422);
    const foreignDoctor = await getApplication().inject({
      method: 'PUT',
      url: `${tenantRoot(tenantA)}/encounters/${apiEncounterId}/services`,
      headers: bearerHeaders(),
      payload: {
        expectedVersion: 3,
        serviceRecords: [{ serviceId: clinicalServiceId, providerDoctorId: otherTenantDoctorId }],
      },
    });
    expect(foreignDoctor.statusCode).toBe(422);

    const planned = await getApplication().inject({
      method: 'PUT',
      url: `${tenantRoot(tenantA)}/encounters/${apiEncounterId}/services`,
      headers: bearerHeaders(),
      payload: {
        expectedVersion: 3,
        serviceRecords: [
          {
            serviceId: clinicalServiceId,
            providerDoctorId: clinicalDoctorId,
            status: 'PLANNED',
            note: 'Clinician-entered service note',
          },
        ],
      },
    });
    expect(planned.statusCode).toBe(200);
    const serviceRecord = planned.json<{
      version: number;
      serviceRecords: Array<{ id: string }>;
    }>();
    expect(serviceRecord.version).toBe(4);
    const serviceRecordId = serviceRecord.serviceRecords[0]!.id;
    const illegalTransition = await getApplication().inject({
      method: 'PUT',
      url: `${tenantRoot(tenantA)}/encounters/${apiEncounterId}/services`,
      headers: bearerHeaders(),
      payload: {
        expectedVersion: 4,
        serviceRecords: [
          {
            id: serviceRecordId,
            serviceId: clinicalServiceId,
            providerDoctorId: clinicalDoctorId,
            status: 'COMPLETED',
            note: 'Clinician-entered service note',
          },
        ],
      },
    });
    expect(illegalTransition.statusCode).toBe(409);
    const started = await getApplication().inject({
      method: 'PUT',
      url: `${tenantRoot(tenantA)}/encounters/${apiEncounterId}/services`,
      headers: bearerHeaders(),
      payload: {
        expectedVersion: 4,
        serviceRecords: [
          {
            id: serviceRecordId,
            serviceId: clinicalServiceId,
            providerDoctorId: clinicalDoctorId,
            status: 'IN_PROGRESS',
            note: 'Clinician-entered service note',
          },
        ],
      },
    });
    expect(started.statusCode).toBe(200);
    expect(started.json()).toMatchObject({
      serviceRecords: [{ status: 'IN_PROGRESS' }],
    });
    const completedService = await getApplication().inject({
      method: 'PUT',
      url: `${tenantRoot(tenantA)}/encounters/${apiEncounterId}/services`,
      headers: bearerHeaders(),
      payload: {
        expectedVersion: 5,
        serviceRecords: [
          {
            id: serviceRecordId,
            serviceId: clinicalServiceId,
            providerDoctorId: clinicalDoctorId,
            status: 'COMPLETED',
            note: 'Clinician-entered service note',
          },
        ],
      },
    });
    expect(completedService.statusCode).toBe(200);
    expect(completedService.json()).toMatchObject({
      serviceRecords: [{ status: 'COMPLETED', completedAt: expect.any(String) }],
    });

    const completeEncounter = await getApplication().inject({
      method: 'POST',
      url: `${tenantRoot(tenantA)}/encounters/${apiEncounterId}/complete`,
      headers: bearerHeaders(),
      payload: { expectedVersion: 6 },
    });
    expect(completeEncounter.statusCode).toBe(200);
    const completedVersion = completeEncounter.json<{ version: number }>().version;
    const silentEdit = await getApplication().inject({
      method: 'PATCH',
      url: `${tenantRoot(tenantA)}/encounters/${apiEncounterId}/clinical`,
      headers: bearerHeaders(),
      payload: { expectedVersion: completedVersion, clinical: { assessment: 'Silent edit' } },
    });
    expect(silentEdit.statusCode).toBe(409);

    const amendmentReason = 'Verified follow-up requires a correction';
    const amendmentResponse = await getApplication().inject({
      method: 'POST',
      url: `${tenantRoot(tenantA)}/encounters/${apiEncounterId}/amendments`,
      headers: bearerHeaders(),
      payload: { expectedVersion: completedVersion, reason: amendmentReason },
    });
    expect(amendmentResponse.statusCode).toBe(201);
    const openedAmendment = amendmentResponse.json<{
      version: number;
      activeAmendmentId: string;
      amendments: Array<{ reason: string }>;
    }>();
    expect(openedAmendment.amendments[0]?.reason).toBe(amendmentReason);
    const amendmentId = openedAmendment.activeAmendmentId;
    const amendmentUpdate = await getApplication().inject({
      method: 'PATCH',
      url: `${tenantRoot(tenantA)}/encounters/${apiEncounterId}/amendments/${amendmentId}`,
      headers: bearerHeaders(),
      payload: {
        expectedVersion: openedAmendment.version,
        diagnoses: [
          {
            id: primaryDiagnosisId,
            description: 'Verified corrected diagnosis',
            priority: 'PRIMARY',
            clinicalStatus: 'ACTIVE',
            onsetAt: '2026-10-16T00:00:00.000Z',
          },
        ],
        serviceRecords: [
          {
            id: serviceRecordId,
            serviceId: clinicalServiceId,
            providerDoctorId: clinicalDoctorId,
            status: 'COMPLETED',
            note: 'Verified corrected service note',
          },
        ],
      },
    });
    expect(amendmentUpdate.statusCode).toBe(200);
    const updatedAmendmentVersion = amendmentUpdate.json<{ version: number }>().version;
    const finalized = await getApplication().inject({
      method: 'POST',
      url: `${tenantRoot(tenantA)}/encounters/${apiEncounterId}/amendments/${amendmentId}/finalize`,
      headers: bearerHeaders(),
      payload: { expectedVersion: updatedAmendmentVersion },
    });
    expect(finalized.statusCode).toBe(200);
    expect(finalized.json()).toMatchObject({
      status: 'COMPLETED',
      currentRevision: 'AMENDED',
      activeAmendmentId: null,
      diagnoses: [{ description: 'Verified corrected diagnosis' }],
      serviceRecords: [{ note: 'Verified corrected service note' }],
      amendments: [{ status: 'FINALIZED' }],
    });

    const originalDocument = await mongoAdminClient!
      .db(tenantA.databaseName)
      .collection('encounters')
      .findOne({ _id: apiEncounterId, _tenantId: tenantA.id });
    expect(originalDocument?.clinical).toMatchObject({ chiefComplaint: clinicalText });
    expect(originalDocument?.diagnoses).toMatchObject([
      { description: 'Primary clinician-entered diagnosis' },
    ]);
    expect(originalDocument?.amendments).toMatchObject([
      {
        diagnoses: [{ description: 'Verified corrected diagnosis' }],
        serviceRecords: [{ note: 'Verified corrected service note' }],
      },
    ]);
    expect(originalDocument?.serviceRecords).toMatchObject([
      { note: 'Clinician-entered service note' },
    ]);
    expect(JSON.stringify(originalDocument?.history)).not.toContain(clinicalText);
    expect(JSON.stringify(originalDocument?.history)).not.toContain(
      'Primary clinician-entered diagnosis',
    );
    expect(JSON.stringify(originalDocument?.history)).not.toContain(amendmentReason);
    expect(JSON.stringify(originalDocument?.history)).not.toContain(
      'Verified corrected service note',
    );
    const clinicalAudits = await getApplication()
      .get(PrismaService)
      .platformAuditLog.findMany({
        where: {
          subjectTenantId: tenantA.id,
          eventType: PlatformAuditEventType.ENCOUNTER_CLINICAL_UPDATED,
        },
      });
    const encounterAuditIds = clinicalAudits
      .filter(
        (audit) =>
          audit.metadata !== null &&
          typeof audit.metadata === 'object' &&
          !Array.isArray(audit.metadata) &&
          audit.metadata.encounterId === apiEncounterId,
      )
      .map((audit) => audit.id);
    const historyEventIds = new Set(
      ((originalDocument?.history as Array<{ id: string }> | undefined) ?? []).map(
        (event) => event.id,
      ),
    );
    expect(encounterAuditIds.length).toBeGreaterThan(0);
    expect(encounterAuditIds.every((id) => historyEventIds.has(id))).toBe(true);
    expect(JSON.stringify(clinicalAudits)).not.toContain(clinicalText);
    expect(JSON.stringify(clinicalAudits)).not.toContain('Primary clinician-entered diagnosis');
    expect(JSON.stringify(clinicalAudits)).not.toContain(amendmentReason);
  });

  it('walks through the signed-in encounter UI in headless Chromium', async () => {
    const appointmentDay = new Date(Date.now() + 36 * 60 * 60 * 1_000);
    const appointmentDateParts = new Map(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Riyadh',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
        .formatToParts(appointmentDay)
        .map(({ type, value }) => [type, value]),
    );
    const worklistDateParts = new Map(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Riyadh',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
        .formatToParts(new Date())
        .map(({ type, value }) => [type, value]),
    );
    const appointmentDate = `${appointmentDateParts.get('year')}-${appointmentDateParts.get('month')}-${appointmentDateParts.get('day')}`;
    const worklistDate = `${worklistDateParts.get('year')}-${worklistDateParts.get('month')}-${worklistDateParts.get('day')}`;
    const appointmentStart = new Date(`${appointmentDate}T10:00:00+03:00`);
    const appointmentPayload = {
      patientId: clinicalPatientId,
      doctorId: clinicalDoctorId,
      facilityId: clinicalFacilityId,
      branchId: clinicalBranchId,
      serviceId: clinicalServiceId,
      startsAt: appointmentStart.toISOString(),
      endsAt: new Date(appointmentStart.getTime() + 30 * 60 * 1_000).toISOString(),
    };
    const appointmentIdempotencyKey = `phase44-${RUN_ID}`;
    const appointmentResponse = await getApplication().inject({
      method: 'POST',
      url: `${tenantRoot(tenantA)}/appointments`,
      headers: { ...bearerHeaders(), 'idempotency-key': appointmentIdempotencyKey },
      payload: appointmentPayload,
    });
    expect(appointmentResponse.statusCode, appointmentResponse.body).toBe(201);
    browserAppointmentId = appointmentResponse.json<{ id: string }>().id;
    const idempotentRetry = await getApplication().inject({
      method: 'POST',
      url: `${tenantRoot(tenantA)}/appointments`,
      headers: { ...bearerHeaders(), 'idempotency-key': appointmentIdempotencyKey },
      payload: appointmentPayload,
    });
    expect(idempotentRetry.statusCode, idempotentRetry.body).toBe(201);
    expect(idempotentRetry.json<{ id: string }>().id).toBe(browserAppointmentId);
    const conflictingRetry = await getApplication().inject({
      method: 'POST',
      url: `${tenantRoot(tenantA)}/appointments`,
      headers: { ...bearerHeaders(), 'idempotency-key': appointmentIdempotencyKey },
      payload: {
        ...appointmentPayload,
        startsAt: new Date(appointmentStart.getTime() + 60 * 60 * 1_000).toISOString(),
        endsAt: new Date(appointmentStart.getTime() + 90 * 60 * 1_000).toISOString(),
      },
    });
    expect(conflictingRetry.statusCode, conflictingRetry.body).toBe(409);

    const [tenantPatientResponse, otherTenantPatientLookup] = await Promise.all([
      getApplication().inject({
        method: 'GET',
        url: `${tenantRoot(tenantA)}/patients/${clinicalPatientId}`,
        headers: bearerHeaders(),
      }),
      getApplication().inject({
        method: 'GET',
        url: `${tenantRoot(tenantB)}/patients/${otherTenantPatientId}`,
        headers: bearerHeaders(),
      }),
    ]);
    expect(tenantPatientResponse.statusCode).toBe(200);
    expect(otherTenantPatientLookup.statusCode).toBe(200);
    const tenantPatientNumber = tenantPatientResponse.json<{ patientNumber: string }>()
      .patientNumber;
    const otherTenantPatientNumber = otherTenantPatientLookup.json<{ patientNumber: string }>()
      .patientNumber;

    const limitedLogin = await getApplication().inject({
      method: 'POST',
      url: `/${APP_CONSTANTS.apiPrefix}/${APP_CONSTANTS.apiVersion}/auth/login`,
      payload: { email: limitedUserEmail, password: limitedUserPassword },
    });
    expect(limitedLogin.statusCode).toBe(200);
    const limitedHeaders = {
      authorization: `Bearer ${limitedLogin.json<{ accessToken: string }>().accessToken}`,
    };
    const limitedAppointmentList = await getApplication().inject({
      method: 'GET',
      url: `${tenantRoot(tenantA)}/appointments?facilityId=${clinicalFacilityId}&branchId=${clinicalBranchId}`,
      headers: limitedHeaders,
    });
    expect(limitedAppointmentList.statusCode).toBe(200);
    expect(limitedAppointmentList.json<{ items: Array<{ id: string }> }>().items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: browserAppointmentId })]),
    );
    const deniedClinicalRead = await getApplication().inject({
      method: 'GET',
      url: `${tenantRoot(tenantA)}/encounters/${apiEncounterId}`,
      headers: limitedHeaders,
    });
    expect(deniedClinicalRead.statusCode).toBe(403);
    expect(deniedClinicalRead.body).not.toContain('Phase 42 authenticated draft note');

    const browserProfile = mkdtempSync(join(tmpdir(), `phase42-chromium-${RUN_ID}-`));
    const browser = spawn(
      'chromium',
      [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--remote-debugging-port=0',
        '--remote-allow-origins=*',
        `--user-data-dir=${browserProfile}`,
        'about:blank',
      ],
      { stdio: 'ignore', detached: true },
    );
    let client: CdpClient | undefined;
    try {
      let devtoolsPort: string | undefined;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (browser.exitCode !== null) {
          throw new Error(`Headless Chromium exited before CDP started: ${browser.exitCode}`);
        }
        try {
          devtoolsPort = readFileSync(join(browserProfile, 'DevToolsActivePort'), 'utf8')
            .split(/\r?\n/u)[0]
            ?.trim();
        } catch {
          await delay(100);
        }
        if (devtoolsPort) break;
      }
      if (!devtoolsPort) throw new Error('Headless Chromium did not expose a CDP port');

      const devtoolsRoot = `http://127.0.0.1:${devtoolsPort}`;
      const targetResponse = await fetch(
        `${devtoolsRoot}/json/new?${encodeURIComponent('about:blank')}`,
        { method: 'PUT' },
      );
      if (!targetResponse.ok) throw new Error('Headless Chromium could not create a page target');
      const target = (await targetResponse.json()) as { webSocketDebuggerUrl?: string };
      if (!target.webSocketDebuggerUrl) throw new Error('Chromium page target omitted its CDP URL');
      client = await connectCdp(target.webSocketDebuggerUrl);
      let dialogCursor = 0;
      const respondToDialog = async (type: string, promptText?: string): Promise<void> => {
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const eventIndex = client!.events.findIndex(
            (event, index) =>
              index >= dialogCursor && event.method === 'Page.javascriptDialogOpening',
          );
          if (eventIndex >= 0) {
            const event = client!.events[eventIndex]!;
            dialogCursor = eventIndex + 1;
            expect(event.params?.type).toBe(type);
            await client!.send('Page.handleJavaScriptDialog', {
              accept: true,
              ...(promptText !== undefined ? { promptText } : {}),
            });
            return;
          }
          await delay(50);
        }
        throw new Error(`Chromium did not open the expected ${type} dialog`);
      };
      await client.send('Page.enable');
      await client.send('Runtime.enable');
      await client.send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Riyadh' });
      await client.send('Page.navigate', { url: `${browserBaseUrl}/appointments/` });
      await waitForBrowserCondition(
        client,
        `Boolean(document.querySelector('#signin-form input[name="email"]'))`,
        'appointments sign-in form',
      );
      expect(
        await evaluateBrowser(client, `!document.body.innerText.includes('انتهت جلسة الدخول')`),
      ).toBe(true);
      const submitAppointmentsLogin = `(() => {
        const form = document.querySelector('#signin-form');
        if (!form) return false;
        form.querySelector('[name="email"]').value = ${JSON.stringify(testEmail)};
        form.querySelector('[name="password"]').value = ${JSON.stringify(testPassword)};
        form.requestSubmit();
        return true;
      })()`;
      expect(await evaluateBrowser(client, submitAppointmentsLogin)).toBe(true);
      await waitForBrowserCondition(
        client,
        `Array.from(document.querySelectorAll('button[data-action="choose-workspace"]')).some((button) =>
          button.textContent?.includes(${JSON.stringify(tenantA.slug)}))`,
        'appointments workspace selection',
      );
      await evaluateBrowser(
        client,
        `Array.from(document.querySelectorAll('button[data-action="choose-workspace"]'))
          .find((button) => button.textContent?.includes(${JSON.stringify(tenantA.slug)}))
          ?.click()`,
      );
      await waitForBrowserCondition(
        client,
        `Boolean(document.querySelector('[data-action="new-appointment"]'))`,
        'authorized appointments workspace',
      );
      await evaluateBrowser(
        client,
        `document.querySelector('[data-action="new-appointment"]')?.click()`,
      );
      await waitForBrowserCondition(
        client,
        `Boolean(document.querySelector('#appointment-form #patient-search'))`,
        'appointment patient search',
      );
      const searchTenantPatient = `(() => {
        const input = document.querySelector('#patient-search');
        if (!input) return false;
        input.value = ${JSON.stringify(tenantPatientNumber)};
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`;
      expect(await evaluateBrowser(client, searchTenantPatient)).toBe(true);
      await waitForBrowserCondition(
        client,
        `Boolean(document.querySelector('#patientId option[value="${clinicalPatientId}"]'))`,
        'tenant patient search result',
      );
      const searchOtherTenantPatient = `(() => {
        const input = document.querySelector('#patient-search');
        if (!input) return false;
        input.value = ${JSON.stringify(otherTenantPatientNumber)};
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`;
      expect(await evaluateBrowser(client, searchOtherTenantPatient)).toBe(true);
      await waitForBrowserCondition(
        client,
        `!Array.from(document.querySelectorAll('#patientId option')).some((option) =>
          option.value === ${JSON.stringify(otherTenantPatientId)}) &&
          !document.querySelector('#patient-search-help')?.textContent.includes('جارٍ البحث')`,
        'tenant-isolated patient search',
      );
      await client.send('Page.navigate', { url: `${browserBaseUrl}/encounters/` });

      await waitForBrowserCondition(
        client,
        `Array.from(document.querySelectorAll('button[data-action="choose-workspace"]')).some((button) =>
          button.parentElement?.textContent?.includes(${JSON.stringify(tenantA.slug)}))`,
        'encounters workspace after authenticated app switch',
      );

      await waitForBrowserCondition(
        client,
        `Array.from(document.querySelectorAll('button[data-action="choose-workspace"]')).some((button) =>
            button.parentElement?.textContent?.includes(${JSON.stringify(tenantA.slug)}))`,
        'tenant workspace selection',
      );
      const chooseWorkspace = `(() => {
          const button = Array.from(document.querySelectorAll('button[data-action="choose-workspace"]'))
            .find((candidate) => candidate.parentElement?.textContent?.includes(${JSON.stringify(tenantA.slug)}));
          if (!button) return false;
          button.click();
          return true;
        })()`;
      expect(await evaluateBrowser(client, chooseWorkspace)).toBe(true);

      await waitForBrowserCondition(
        client,
        `Boolean(
          document.querySelector('form[data-form="filters"] select[name="facilityId"]') &&
          document.querySelector('form[data-form="filters"] select[name="branchId"]')
        )`,
        'facility and branch filters',
      );
      const selectAssignedBranch = `(() => {
          const form = document.querySelector('form[data-form="filters"]');
          const facility = form?.querySelector('select[name="facilityId"]');
          const branch = form?.querySelector('select[name="branchId"]');
          if (!form || !facility || !branch) return false;
          facility.value = ${JSON.stringify(clinicalFacilityId)};
          branch.value = ${JSON.stringify(clinicalBranchId)};
          if (facility.value !== ${JSON.stringify(clinicalFacilityId)} ||
              branch.value !== ${JSON.stringify(clinicalBranchId)}) return false;
          form.requestSubmit();
          return true;
        })()`;
      expect(await evaluateBrowser(client, selectAssignedBranch)).toBe(true);

      await evaluateBrowser(
        client,
        `document.querySelector('[data-action="view-patient-history"]')?.click()`,
      );
      await waitForBrowserCondition(
        client,
        `Boolean(document.querySelector('form[data-form="patient-history"] select[name="patientId"] option[value="${clinicalPatientId}"]'))`,
        'authorized tenant patient picker',
      );
      expect(
        await evaluateBrowser(
          client,
          `Boolean(document.querySelector('form[data-form="patient-history"] select[name="patientId"] option[value="${otherTenantPatientId}"]'))`,
        ),
      ).toBe(false);
      await evaluateBrowser(
        client,
        `document.querySelector('[data-action="view-worklist"]')?.click()`,
      );
      await waitForBrowserCondition(
        client,
        `Boolean(document.querySelector('input#appointment-date'))`,
        'appointment-to-encounter controls',
      );
      const loadAppointment = `(() => {
          const input = document.querySelector('#appointment-date');
          const branch = document.querySelector('#appointment-branch');
          const button = document.querySelector('[data-action="load-appointments"]');
          if (!input || !branch || !button) return false;
          input.value = ${JSON.stringify(appointmentDate)};
          input.dispatchEvent(new Event('change', { bubbles: true }));
          branch.value = ${JSON.stringify(clinicalBranchId)};
          branch.dispatchEvent(new Event('change', { bubbles: true }));
          button.click();
          return true;
        })()`;
      expect(await evaluateBrowser(client, loadAppointment)).toBe(true);
      await waitForBrowserCondition(
        client,
        `Boolean(document.querySelector('#eligible-appointment option[value="${browserAppointmentId}"]'))`,
        'eligible appointment',
      );
      const createFromAppointment = `(() => {
          const select = document.querySelector('#eligible-appointment');
          if (!select) return false;
          select.value = ${JSON.stringify(browserAppointmentId)};
          select.dispatchEvent(new Event('change', { bubbles: true }));
          const button = document.querySelector('[data-action="create-from-appointment"]');
          if (!button) return false;
          button.click();
          return true;
        })()`;
      expect(await evaluateBrowser(client, createFromAppointment)).toBe(true);
      await waitForBrowserCondition(
        client,
        `Boolean(document.querySelector('form[data-form="clinical"] textarea[name="text.chiefComplaint"]'))`,
        'appointment-linked encounter detail',
      );
      const browserEncounterDocument = await mongoAdminClient!
        .db(tenantA.databaseName)
        .collection('encounters')
        .findOne({ appointmentId: browserAppointmentId, _tenantId: tenantA.id });
      expect(browserEncounterDocument).not.toBeNull();
      browserEncounterId = String(browserEncounterDocument?._id);

      const browserClinicalText = 'Headless authenticated draft save';
      const saveClinical = `(() => {
          const form = document.querySelector('form[data-form="clinical"]');
          const field = form?.querySelector('textarea[name="text.chiefComplaint"]');
          if (!form || !field) return false;
          field.value = ${JSON.stringify(browserClinicalText)};
          form.requestSubmit();
          return true;
        })()`;
      await mongoAdminClient!.db('admin').command({
        configureFailPoint: 'failCommand',
        mode: 'alwaysOn',
        data: { failCommands: ['findAndModify'], errorCode: 91 },
      });
      const outageClinicalText = 'Draft retained while clinical storage is unavailable';
      const submitDuringOutage = `(() => {
        const form = document.querySelector('form[data-form="clinical"]');
        const field = form?.querySelector('textarea[name="text.chiefComplaint"]');
        if (!form || !field) return false;
        field.value = ${JSON.stringify(outageClinicalText)};
        form.requestSubmit();
        return true;
      })()`;
      try {
        expect(await evaluateBrowser(client, submitDuringOutage)).toBe(true);
        await waitForBrowserCondition(
          client,
          `Boolean(document.querySelector('.encounter-notice.encounter-error'))`,
          'visible clinical save failure during MongoDB outage',
        );
        expect(
          await evaluateBrowser(
            client,
            `document.querySelector('form[data-form="clinical"] textarea[name="text.chiefComplaint"]')?.value === ${JSON.stringify(outageClinicalText)} &&
              document.querySelector('.encounter-notice.encounter-error')?.innerText.includes('التخزين السريري غير متاح')`,
          ),
        ).toBe(true);
        expect(
          await mongoAdminClient!
            .db(tenantA.databaseName)
            .collection('encounters')
            .findOne({ _id: browserEncounterId, _tenantId: tenantA.id }),
        ).toMatchObject({ version: 1 });
      } finally {
        await mongoAdminClient!.db('admin').command({
          configureFailPoint: 'failCommand',
          mode: 'off',
        });
      }
      let completionStorageRecovered = false;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const recoveryProbe = await getApplication().inject({
          method: 'GET',
          url: `${tenantRoot(tenantA)}/encounters/${browserEncounterId}`,
          headers: bearerHeaders(),
        });
        if (recoveryProbe.statusCode === 200) {
          completionStorageRecovered = true;
          break;
        }
        await delay(500);
      }
      expect(completionStorageRecovered).toBe(true);
      expect(await evaluateBrowser(client, saveClinical)).toBe(true);
      await waitForBrowserCondition(
        client,
        `document.body.innerText.includes('الإصدار الحالي: 2')`,
        'saved draft revision',
      );
      expect(
        await evaluateBrowser(
          client,
          `document.querySelector('textarea[name="text.chiefComplaint"]')?.value`,
        ),
      ).toBe(browserClinicalText);

      const addDiagnosis = `(() => {
          const button = document.querySelector('button[data-action="add-diagnosis"]');
          if (!button) return false;
          button.click();
          const form = document.querySelector('form[data-form="diagnoses"]');
          const description = form?.querySelector('[name="description"]');
          const priority = form?.querySelector('[name="priority"]');
          const status = form?.querySelector('[name="clinicalStatus"]');
          if (!form || !description || !priority || !status) return false;
          description.value = 'Browser-verified diagnosis';
          priority.value = 'PRIMARY';
          status.value = 'ACTIVE';
          form.requestSubmit();
          return true;
        })()`;
      expect(await evaluateBrowser(client, addDiagnosis)).toBe(true);
      await waitForBrowserCondition(
        client,
        `document.body.innerText.includes('الإصدار الحالي: 3')`,
        'saved structured diagnosis',
      );

      const addService = `(() => {
          const button = document.querySelector('button[data-action="add-service-record"]');
          if (!button) return 'missing-add-button';
          button.click();
          const form = document.querySelector('form[data-form="services"]');
          const service = form?.querySelector('[name="serviceId"]');
          const provider = form?.querySelector('[name="providerDoctorId"]');
          const note = form?.querySelector('[name="note"]');
          if (!form) return 'missing-service-form';
          if (!service || !provider || !note) {
            return \`missing-fields:\${Array.from(form.querySelectorAll('input,select,textarea')).map((field) => field.name).join(',')}\`;
          }
          service.value = ${JSON.stringify(clinicalServiceId)};
          provider.value = ${JSON.stringify(clinicalDoctorId)};
          note.value = 'Browser-verified service record';
          form.requestSubmit();
          return 'submitted';
        })()`;
      const serviceSubmitResult = await evaluateBrowser(client, addService);
      const browserExceptions = client.events
        .filter((event) => event.method === 'Runtime.exceptionThrown')
        .map((event) => {
          const details = event.params?.exceptionDetails as
            { text?: string; exception?: { description?: string } } | undefined;
          return details?.exception?.description || details?.text || 'Uncaught browser exception';
        });
      expect(serviceSubmitResult, browserExceptions.join('\n')).toBe('submitted');
      await waitForBrowserCondition(
        client,
        `document.body.innerText.includes('الإصدار الحالي: 4')`,
        'saved service record',
      );

      await client.send('Page.reload');
      await waitForBrowserCondition(
        client,
        `Array.from(document.querySelectorAll('button[data-action="choose-workspace"]')).some((button) =>
          button.parentElement?.textContent?.includes(${JSON.stringify(tenantA.slug)}))`,
        'workspace selection after reload',
      );
      expect(
        await evaluateBrowser(
          client,
          `(() => {
            const button = Array.from(document.querySelectorAll('button[data-action="choose-workspace"]'))
              .find((candidate) => candidate.parentElement?.textContent?.includes(${JSON.stringify(tenantA.slug)}));
            button?.click();
            return Boolean(button);
          })()`,
        ),
      ).toBe(true);
      await waitForBrowserCondition(
        client,
        `Boolean(document.querySelector('form[data-form="filters"]'))`,
        'encounter worklist after reload',
      );
      const reloadFilter = `(() => {
        const form = document.querySelector('form[data-form="filters"]');
        if (!form) return false;
        form.querySelector('[name="date"]').value = ${JSON.stringify(worklistDate)};
        form.querySelector('[name="facilityId"]').value = ${JSON.stringify(clinicalFacilityId)};
        form.querySelector('[name="branchId"]').value = ${JSON.stringify(clinicalBranchId)};
        form.requestSubmit();
        return true;
      })()`;
      expect(await evaluateBrowser(client, reloadFilter)).toBe(true);
      await waitForBrowserCondition(
        client,
        `Boolean(document.querySelector('button[data-action="open-encounter"][data-id="${browserEncounterId}"]'))`,
        'persisted appointment encounter in worklist',
      );
      await evaluateBrowser(
        client,
        `document.querySelector('button[data-action="open-encounter"][data-id="${browserEncounterId}"]')?.click()`,
      );
      await waitForBrowserCondition(
        client,
        `document.querySelector('textarea[name="text.chiefComplaint"]')?.value === ${JSON.stringify(browserClinicalText)}`,
        'reloaded clinical documentation',
      );
      expect(
        await evaluateBrowser(
          client,
          `document.querySelector('form[data-form="diagnoses"] textarea[name="description"]')?.value === 'Browser-verified diagnosis'`,
        ),
      ).toBe(true);
      expect(
        await evaluateBrowser(
          client,
          `document.querySelector('form[data-form="services"] textarea[name="note"]')?.value === 'Browser-verified service record'`,
        ),
      ).toBe(true);

      const admin = mongoAdminClient?.db('admin');
      if (!admin) throw new Error('Disposable MongoDB administrator client is unavailable');
      await admin.command({
        configureFailPoint: 'failCommand',
        mode: { times: 1 },
        data: { failCommands: ['findAndModify'], errorCode: 91 },
      });
      try {
        const failedCompletion = evaluateBrowser(
          client,
          `document.querySelector('[data-action="complete-encounter"]')?.click()`,
        );
        await respondToDialog('confirm');
        await failedCompletion;
        await waitForBrowserCondition(
          client,
          `Boolean(document.querySelector('.encounter-notice.encounter-error')) &&
            document.querySelector('[data-status="DRAFT"]') !== null`,
          'visible completion failure while the encounter remains a draft',
        );
        expect(
          await mongoAdminClient!
            .db(tenantA.databaseName)
            .collection('encounters')
            .findOne({ _id: browserEncounterId, _tenantId: tenantA.id }),
        ).toMatchObject({ status: 'DRAFT' });
      } finally {
        await admin.command({ configureFailPoint: 'failCommand', mode: 'off' });
      }
      let storageRecovered = false;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const probe = await getApplication().inject({
          method: 'GET',
          url: `${tenantRoot(tenantA)}/encounters/${browserEncounterId}`,
          headers: bearerHeaders(),
        });
        if (probe.statusCode === 200) {
          storageRecovered = true;
          break;
        }
        await delay(250);
      }
      expect(storageRecovered).toBe(true);
      const completionClick = evaluateBrowser(
        client,
        `document.querySelector('[data-action="complete-encounter"]')?.click()`,
      );
      await respondToDialog('confirm');
      await completionClick;
      await waitForBrowserCondition(
        client,
        `document.querySelector('[data-status="COMPLETED"]') !== null`,
        'completed encounter',
      );
      expect(
        await evaluateBrowser(
          client,
          `document.querySelector('form[data-form="clinical"]') === null`,
        ),
      ).toBe(true);

      const amendmentReason = 'Browser-verified correction reason';
      const amendmentClick = evaluateBrowser(
        client,
        `document.querySelector('[data-action="create-amendment"]')?.click()`,
      );
      await respondToDialog('prompt', amendmentReason);
      await amendmentClick;
      await waitForBrowserCondition(
        client,
        `Boolean(document.querySelector('form[data-form="clinical"]'))`,
        'reasoned amendment editor',
      );
      const amendedClinicalText = 'Browser-verified amended clinical note';
      await evaluateBrowser(
        client,
        `(() => {
          const form = document.querySelector('form[data-form="clinical"]');
          const field = form?.querySelector('textarea[name="text.chiefComplaint"]');
          if (!form || !field) return false;
          field.value = ${JSON.stringify(amendedClinicalText)};
          form.requestSubmit();
          return true;
        })()`,
      );
      await waitForBrowserCondition(
        client,
        `Array.from(document.querySelectorAll('.encounter-detail')).some((item) =>
          item.querySelector('strong')?.innerText === 'الإصدار' &&
          item.querySelector('span')?.innerText === '7')`,
        'amended clinical save',
      );
      const amendedDiagnosis = 'Browser-verified amended diagnosis';
      await evaluateBrowser(
        client,
        `(() => {
          const form = document.querySelector('form[data-form="diagnoses"]');
          const field = form?.querySelector('textarea[name="description"]');
          if (!form || !field) return false;
          field.value = ${JSON.stringify(amendedDiagnosis)};
          form.requestSubmit();
          return true;
        })()`,
      );
      await waitForBrowserCondition(
        client,
        `document.querySelector('form[data-form="diagnoses"] textarea[name="description"]')?.value === ${JSON.stringify(amendedDiagnosis)} &&
          Array.from(document.querySelectorAll('.encounter-detail')).some((item) =>
            item.querySelector('strong')?.innerText === 'الإصدار' &&
            item.querySelector('span')?.innerText === '8')`,
        'amended diagnosis save',
      );
      const amendedServiceNote = 'Browser-verified amended service note';
      await evaluateBrowser(
        client,
        `(() => {
          const form = document.querySelector('form[data-form="services"]');
          const field = form?.querySelector('textarea[name="note"]');
          if (!form || !field) return false;
          field.value = ${JSON.stringify(amendedServiceNote)};
          form.requestSubmit();
          return true;
        })()`,
      );
      await waitForBrowserCondition(
        client,
        `document.querySelector('form[data-form="services"] textarea[name="note"]')?.value === ${JSON.stringify(amendedServiceNote)} &&
          Array.from(document.querySelectorAll('.encounter-detail')).some((item) =>
            item.querySelector('strong')?.innerText === 'الإصدار' &&
            item.querySelector('span')?.innerText === '9')`,
        'amended service save',
      );
      const finalizeClick = evaluateBrowser(
        client,
        `document.querySelector('[data-action="finalize-amendment"]')?.click()`,
      );
      await respondToDialog('confirm');
      await finalizeClick;
      await waitForBrowserCondition(
        client,
        `document.querySelector('[data-status="COMPLETED"]') !== null &&
          document.querySelector('form[data-form="clinical"]') === null &&
          document.querySelector('form[data-form="diagnoses"]') === null &&
          document.querySelector('form[data-form="services"]') === null`,
        'finalized amended encounter',
      );

      const storedBrowserEncounter = await mongoAdminClient!
        .db(tenantA.databaseName)
        .collection('encounters')
        .findOne({ _id: browserEncounterId, _tenantId: tenantA.id });
      expect(storedBrowserEncounter?.appointmentId).toBe(browserAppointmentId);
      expect(storedBrowserEncounter?.status).toBe('COMPLETED');
      expect(storedBrowserEncounter?.clinical).toMatchObject({
        chiefComplaint: browserClinicalText,
      });
      expect(storedBrowserEncounter?.diagnoses).toMatchObject([
        { description: 'Browser-verified diagnosis', priority: 'PRIMARY' },
      ]);
      expect(storedBrowserEncounter?.serviceRecords).toMatchObject([
        { serviceId: clinicalServiceId, note: 'Browser-verified service record' },
      ]);
      expect(storedBrowserEncounter?.amendments).toMatchObject([
        {
          reason: amendmentReason,
          status: 'FINALIZED',
          clinical: { chiefComplaint: amendedClinicalText },
          diagnoses: [{ description: amendedDiagnosis }],
          serviceRecords: [{ note: amendedServiceNote }],
        },
      ]);

      const prisma = getApplication().get(PrismaService);
      const browserSession = await prisma.platformSession.findFirst({
        where: { userId: platformUserId, status: PlatformSessionStatus.ACTIVE },
        orderBy: { createdAt: 'desc' },
      });
      expect(browserSession).not.toBeNull();
      await prisma.platformSession.update({
        where: { id: browserSession!.id },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });
      await evaluateBrowser(
        client,
        `document.querySelector('[data-action="load-history"]')?.click()`,
      );
      await waitForBrowserCondition(
        client,
        `Boolean(document.querySelector('form[data-form="signin"]'))`,
        'signed-out state after expired session',
      );
      expect(
        await evaluateBrowser(
          client,
          `(() => {
            const visible = document.body.innerText;
            const stored = JSON.stringify({
              local: Object.values(localStorage),
              session: Object.values(sessionStorage),
            });
            return !visible.includes(${JSON.stringify(browserClinicalText)}) &&
              !visible.includes(${JSON.stringify(amendedClinicalText)}) &&
              !visible.includes(${JSON.stringify(amendedDiagnosis)}) &&
              !visible.includes(${JSON.stringify(amendedServiceNote)}) &&
              !stored.includes(${JSON.stringify(browserClinicalText)}) &&
              !stored.includes(${JSON.stringify(amendedClinicalText)});
          })()`,
        ),
      ).toBe(true);
    } finally {
      await Promise.race([client?.send('Browser.close').catch(() => undefined), delay(1_000)]);
      client?.close();
      if (browser.pid) {
        const exited = new Promise<void>((resolvePromise) => {
          if (browser.exitCode !== null) {
            resolvePromise();
          } else {
            browser.once('exit', () => resolvePromise());
          }
        });
        try {
          process.kill(-browser.pid, 'SIGTERM');
        } catch {
          browser.kill('SIGTERM');
        }
        await Promise.race([exited, delay(5_000)]);
        try {
          process.kill(-browser.pid, 'SIGKILL');
        } catch {
          browser.kill('SIGKILL');
        }
        await Promise.race([exited, delay(5_000)]);
      }
      await delay(250);
      rmSync(browserProfile, { recursive: true, force: true, maxRetries: 60, retryDelay: 100 });
    }
  }, 120_000);

  it('recovers an appointment after the committed HTTP acknowledgement is dropped', async () => {
    const appointments = mongoAdminClient!.db(tenantA.databaseName).collection('appointments');
    const baseline = await appointments.findOne({
      _id: browserAppointmentId,
      _tenantId: tenantA.id,
    });
    expect(baseline).not.toBeNull();
    const startsAt = new Date(baseline!.startsAt);
    startsAt.setTime(startsAt.getTime() + 60 * 60 * 1_000);
    const endsAt = new Date(startsAt.getTime() + 30 * 60 * 1_000);
    const payload = {
      patientId: clinicalPatientId,
      doctorId: clinicalDoctorId,
      facilityId: clinicalFacilityId,
      branchId: clinicalBranchId,
      serviceId: clinicalServiceId,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    };
    const idempotencyKey = `phase45c-dropped-ack-${RUN_ID}`;
    let resolveUpstreamStatus!: (status: number) => void;
    const upstreamStatus = new Promise<number>((resolvePromise) => {
      resolveUpstreamStatus = resolvePromise;
    });
    const proxy = createServer((incoming, outgoing) => {
      void (async (): Promise<void> => {
        const chunks: Buffer[] = [];
        for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
        const headers: Record<string, string> = {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
          'idempotency-key': idempotencyKey,
        };
        const upstream = await fetch(`${browserBaseUrl}${incoming.url}`, {
          method: incoming.method,
          headers,
          body: Buffer.concat(chunks),
        });
        await upstream.arrayBuffer();
        resolveUpstreamStatus(upstream.status);
        outgoing.destroy();
      })().catch(() => {
        resolveUpstreamStatus(0);
        outgoing.destroy();
      });
    });
    await new Promise<void>((resolvePromise, reject) => {
      proxy.once('error', reject);
      proxy.listen(0, '127.0.0.1', () => resolvePromise());
    });
    const proxyAddress = proxy.address();
    if (!proxyAddress || typeof proxyAddress === 'string') {
      throw new Error('Acknowledgement-drop proxy did not report its assigned address');
    }

    try {
      const clientReceivedResponse = await fetch(
        `http://127.0.0.1:${proxyAddress.port}/${APP_CONSTANTS.apiPrefix}/${APP_CONSTANTS.apiVersion}/tenants/${tenantA.id}/appointments`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${accessToken}`,
            'content-type': 'application/json',
            'idempotency-key': idempotencyKey,
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(15_000),
        },
      ).then(
        () => true,
        () => false,
      );
      expect(clientReceivedResponse).toBe(false);
      expect(await upstreamStatus).toBe(201);

      const retry = await getApplication().inject({
        method: 'POST',
        url: `${tenantRoot(tenantA)}/appointments`,
        headers: { ...bearerHeaders(), 'idempotency-key': idempotencyKey },
        payload,
      });
      expect(retry.statusCode, retry.body).toBe(201);
      const appointmentId = retry.json<{ id: string }>().id;
      expect(await appointments.countDocuments({ _id: appointmentId, _tenantId: tenantA.id })).toBe(
        1,
      );
    } finally {
      await new Promise<void>((resolvePromise) => {
        proxy.close(() => resolvePromise());
      });
    }
  }, 60_000);

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
    expect(uniquePatientNumberIndex?.collation).toBeUndefined();
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

  it('lists only authenticated active workspaces and server-resolved permission codes', async () => {
    const unauthenticated = await getApplication().inject({
      method: 'GET',
      url: '/api/v1/session/tenants',
    });
    expect(unauthenticated.statusCode).toBe(401);

    const response = await getApplication().inject({
      method: 'GET',
      url: '/api/v1/session/tenants',
      headers: bearerHeaders(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: expect.arrayContaining([
        {
          tenantId: tenantA.id,
          displayName: `Phase 30 ${tenantA.slug}`,
          slug: tenantA.slug,
          membershipId: tenantA.membershipId,
          permissionCodes: expect.arrayContaining([
            'tenant.patients.manage',
            'tenant.patients.read',
          ]),
        },
        {
          tenantId: tenantB.id,
          displayName: `Phase 30 ${tenantB.slug}`,
          slug: tenantB.slug,
          membershipId: tenantB.membershipId,
          permissionCodes: expect.arrayContaining([
            'tenant.patients.manage',
            'tenant.patients.read',
          ]),
        },
      ]),
    });
    expect(response.json()).not.toHaveProperty('items.0.databaseName');
    expect(response.json()).not.toHaveProperty('items.0.connectionReference');
  });

  it('persists tenant-isolated encounters and atomically rejects concurrent appointment duplicates', async () => {
    const storage = getApplication().get(MongoTenantEncounterStorage);
    const resolver = getApplication().get(TenantStorageResolverService);
    await storage.ensureIndexesForTarget(targetA);
    await storage.ensureIndexesForTarget(targetB);
    const routeA = await resolver.resolve(contextA);
    const routeB = await resolver.resolve(contextB);
    const now = new Date();
    const appointmentId = randomUUID();
    const makeEncounter = (id: string): EncounterRecord => {
      const created: EncounterHistoryEvent = {
        id: randomUUID(),
        action: 'CREATED',
        actorUserId: contextA.platformUserId,
        occurredAt: now,
        fromVersion: 0,
        toVersion: 1,
        changedFields: ['appointmentId', 'patientId', 'doctorId', 'facilityId'],
      };
      return {
        id,
        appointmentId,
        patientId: randomUUID(),
        doctorId: randomUUID(),
        facilityId: randomUUID(),
        branchId: null,
        encounterAt: now,
        status: 'DRAFT',
        clinical: {},
        version: 1,
        createdAt: now,
        updatedAt: now,
        createdBy: contextA.platformUserId,
        updatedBy: contextA.platformUserId,
        completedAt: null,
        completedBy: null,
        cancelledAt: null,
        cancelledBy: null,
        cancellationReason: null,
        history: [created],
      };
    };
    const attempts = await Promise.allSettled([
      storage.create(contextA, routeA, makeEncounter(randomUUID())),
      storage.create(contextA, routeA, makeEncounter(randomUUID())),
    ]);
    const created = attempts.filter(
      (result: PromiseSettledResult<EncounterRecord>) => result.status === 'fulfilled',
    ) as PromiseFulfilledResult<EncounterRecord>[];
    const rejected = attempts.find(
      (result: PromiseSettledResult<EncounterRecord>) => result.status === 'rejected',
    ) as PromiseRejectedResult | undefined;
    expect(created).toHaveLength(1);
    expect(rejected?.reason).toBeInstanceOf(EncounterAppointmentConflictError);

    const winner = created[0]!.value;
    const searchResult = await storage.list(contextA, routeA, {
      search: winner.patientId,
      limit: 50,
      offset: 0,
      accessScope: { unrestricted: true, facilityIds: [], branchIds: [] },
    });
    expect(searchResult.items.map((item: EncounterRecord) => item.id)).toContain(winner.id);
    const tenantBRecord = await storage.create(contextB, routeB, makeEncounter(randomUUID()));
    expect(tenantBRecord.appointmentId).toBe(appointmentId);
    expect(await storage.findById(contextB, routeB, winner.id)).toBeNull();
    expect(await storage.findActiveByAppointment(contextA, routeA, appointmentId)).toMatchObject({
      id: winner.id,
    });

    const updatedAt = new Date();
    const clinicalText = 'integration-note-that-must-not-enter-history';
    const event: EncounterHistoryEvent = {
      id: randomUUID(),
      action: 'CLINICAL_UPDATED',
      actorUserId: contextA.platformUserId,
      occurredAt: updatedAt,
      fromVersion: 1,
      toVersion: 2,
      changedFields: ['assessment'],
    };
    const updated = await storage.update(
      contextA,
      routeA,
      winner.id,
      1,
      'DRAFT',
      {
        clinical: { assessment: clinicalText },
        updatedAt,
        updatedBy: contextA.platformUserId,
      },
      event,
    );
    expect(updated?.version).toBe(2);
    const history = await storage.history(contextA, routeA, winner.id);
    expect(history).toHaveLength(2);
    expect(JSON.stringify(history)).not.toContain(clinicalText);
  });

  it('fails closed when a required encounter index disappears', async () => {
    const storage = getApplication().get(MongoTenantEncounterStorage);
    const resolver = getApplication().get(TenantStorageResolverService);
    const clients = getApplication().get(TenantMongoClientManager);
    await storage.ensureIndexesForTarget(targetA);
    const route = await resolver.resolve(contextA);
    const database = await clients.getDatabase(targetA);
    await database.collection('encounters').dropIndex('tenant_encounter_patient_date_idx');

    await expect(storage.findById(contextA, route, randomUUID())).rejects.toBeInstanceOf(
      TenantStorageUnavailableError,
    );

    await storage.ensureIndexesForTarget(targetA);
  });

  it('persists appointments in the trusted tenant database with real indexed isolation and overlap queries', async () => {
    const storage = getApplication().get(MongoTenantAppointmentStorage);
    const routeA: TenantStorageRoute = {
      placements: [{ placementId: targetA.id as TenantStoragePlacementId }],
    };
    const routeB: TenantStorageRoute = {
      placements: [{ placementId: targetB.id as TenantStoragePlacementId }],
    };
    const now = new Date('2026-10-14T12:00:00.000Z');
    const appointmentId = randomUUID();
    const record = {
      id: appointmentId,
      patientId: randomUUID(),
      doctorId: randomUUID(),
      facilityId: randomUUID(),
      branchId: randomUUID(),
      serviceId: null,
      startsAt: new Date('2026-10-15T09:00:00.000Z'),
      endsAt: new Date('2026-10-15T09:30:00.000Z'),
      status: 'SCHEDULED',
      reason: 'Integration test reason',
      createdAt: now,
      updatedAt: now,
      createdBy: platformUserId,
      updatedBy: platformUserId,
      cancelledAt: null,
      cancelledBy: null,
      version: 1,
    };

    await expect(storage.create(contextA, routeA, record)).resolves.toMatchObject({
      id: appointmentId,
      facilityId: record.facilityId,
      reason: record.reason,
    });
    await expect(storage.findById(contextA, routeA, appointmentId)).resolves.toMatchObject({
      id: appointmentId,
      status: 'SCHEDULED',
    });
    await expect(storage.findById(contextB, routeB, appointmentId)).resolves.toBeNull();
    await expect(storage.findById(contextA, routeB, appointmentId)).rejects.toBeInstanceOf(
      TenantStorageNotConfiguredError,
    );

    await expect(
      storage.hasProviderOverlap(contextA, routeA, {
        doctorId: record.doctorId,
        startsAt: new Date('2026-10-15T09:15:00.000Z'),
        endsAt: new Date('2026-10-15T09:45:00.000Z'),
      }),
    ).resolves.toBe(true);
    await expect(
      storage.hasProviderOverlap(contextA, routeA, {
        doctorId: record.doctorId,
        startsAt: new Date('2026-10-15T09:30:00.000Z'),
        endsAt: new Date('2026-10-15T10:00:00.000Z'),
      }),
    ).resolves.toBe(false);

    const listed = await storage.list(contextA, routeA, {
      from: new Date('2026-10-15T09:15:00.000Z'),
      to: new Date('2026-10-15T09:45:00.000Z'),
      branchId: record.branchId,
      limit: 10,
      offset: 0,
      accessScope: { unrestricted: true, facilityIds: [], branchIds: [] },
    });
    expect(listed).toMatchObject({ total: 1, items: [{ id: appointmentId }] });
    expect(listed.items[0]).not.toHaveProperty('_tenantId');

    const cancelled = await storage.update(contextA, routeA, appointmentId, 1, {
      status: 'CANCELLED',
      cancelledAt: new Date('2026-10-14T13:00:00.000Z'),
      cancelledBy: platformUserId,
      updatedAt: new Date('2026-10-14T13:00:00.000Z'),
      updatedBy: platformUserId,
    });
    expect(cancelled).toMatchObject({ status: 'CANCELLED', version: 2 });
    await expect(
      storage.hasProviderOverlap(contextA, routeA, {
        doctorId: record.doctorId,
        startsAt: record.startsAt,
        endsAt: record.endsAt,
      }),
    ).resolves.toBe(false);

    const names = new Set(
      (await mongoAdminClient!.db(tenantA.databaseName).collection('appointments').indexes()).map(
        ({ name }) => name,
      ),
    );
    expect(names).toContain('tenant_appointment_schedule_overlap_idx');
    expect(names).toContain('tenant_appointment_branch_starts_idx');
    expect(names).toContain('tenant_appointment_patient_starts_idx');
    expect(names).toContain('tenant_appointment_service_starts_idx');
  });

  it('searches patients across the tenant appointment dataset before stable pagination and combined filters', async () => {
    const storage = getApplication().get(MongoTenantAppointmentStorage);
    const routeA: TenantStorageRoute = {
      placements: [{ placementId: targetA.id as TenantStoragePlacementId }],
    };
    await storage.ensureIndexesForTarget(targetA);
    await storage.ensureIndexesForTarget(targetB);
    const patientId = randomUUID();
    const serviceId = randomUUID();
    const facilityId = randomUUID();
    const doctorId = randomUUID();
    const branchId = randomUUID();
    const now = new Date('2026-10-15T12:00:00.000Z');
    const matchingPatient = {
      _id: patientId,
      _tenantId: tenantA.id,
      patientNumber: 'PHASE40-SEARCH-001',
      firstName: 'Layla',
      middleName: 'Shared',
      lastName: 'Record',
      preferredName: null,
      phone: '+966500000001',
      email: 'layla.phase40@example.test',
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    };
    await mongoAdminClient!
      .db(tenantA.databaseName)
      .collection('patients')
      .insertOne(matchingPatient);
    await mongoAdminClient!
      .db(tenantB.databaseName)
      .collection('patients')
      .insertOne({ ...matchingPatient, _tenantId: tenantB.id });

    const tenantAAppointmentIds: string[] = [];
    const tenantADocuments: Document[] = [];
    for (let index = 0; index < 25; index += 1) {
      const id = randomUUID();
      tenantAAppointmentIds.push(id);
      const startsAt = new Date(Date.parse('2026-10-15T00:00:00.000Z') + index * 60_000);
      tenantADocuments.push({
        _id: id,
        _tenantId: tenantA.id,
        patientId,
        doctorId,
        facilityId,
        branchId,
        serviceId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 30 * 60_000),
        status: 'SCHEDULED',
        reason: null,
        createdAt: now,
        updatedAt: now,
        createdBy: platformUserId,
        updatedBy: platformUserId,
        cancelledAt: null,
        cancelledBy: null,
        version: 1,
      });
    }
    await mongoAdminClient!
      .db(tenantA.databaseName)
      .collection('appointments')
      .insertMany(tenantADocuments);
    const tenantBAppointmentId = randomUUID();
    await mongoAdminClient!
      .db(tenantB.databaseName)
      .collection('appointments')
      .insertOne({
        _id: tenantBAppointmentId,
        _tenantId: tenantB.id,
        patientId,
        doctorId,
        facilityId,
        branchId,
        serviceId,
        startsAt: new Date('2026-10-15T08:00:00.000Z'),
        endsAt: new Date('2026-10-15T08:30:00.000Z'),
        status: 'SCHEDULED',
        reason: null,
        createdAt: now,
        updatedAt: now,
        createdBy: platformUserId,
        updatedBy: platformUserId,
        cancelledAt: null,
        cancelledBy: null,
        version: 1,
      });

    const listed = await storage.list(contextA, routeA, {
      search: 'Layla Shared Record',
      searchPatientRecords: true,
      from: new Date('2026-10-15T00:00:00.000Z'),
      to: new Date('2026-10-16T00:00:00.000Z'),
      facilityId,
      doctorId,
      branchId,
      serviceId,
      status: 'SCHEDULED',
      limit: 10,
      offset: 20,
      accessScope: { unrestricted: true, facilityIds: [], branchIds: [] },
    });

    expect(listed).toMatchObject({ total: 25, limit: 10, offset: 20, hasNext: false });
    expect(listed.items).toHaveLength(5);
    expect(listed.items.map((item) => item.id)).toEqual(tenantAAppointmentIds.slice(20));
    expect(listed.items.map((item) => item.id)).not.toContain(tenantBAppointmentId);
    expect(listed.items[0]).not.toHaveProperty('patientName');
    expect(listed.items[0]).not.toHaveProperty('phone');
  });

  it('serializes overlapping MongoDB bookings and cleans only locks owned by the operation', async () => {
    const storage = getApplication().get(MongoTenantAppointmentStorage);
    const route: TenantStorageRoute = {
      placements: [{ placementId: targetA.id as TenantStoragePlacementId }],
    };
    const doctorId = randomUUID();
    const facilityId = randomUUID();
    const startsAt = new Date('2026-10-20T09:00:00.000Z');
    const endsAt = new Date('2026-10-20T09:30:00.000Z');
    const locks = [
      { resourceType: 'DOCTOR' as const, resourceId: doctorId },
      { resourceType: 'FACILITY' as const, resourceId: facilityId },
    ];
    const record = {
      id: randomUUID(),
      patientId: randomUUID(),
      doctorId,
      facilityId,
      branchId: null,
      serviceId: null,
      startsAt,
      endsAt,
      status: 'SCHEDULED' as const,
      reason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: platformUserId,
      updatedBy: platformUserId,
      cancelledAt: null,
      cancelledBy: null,
      version: 1,
    };

    let announceAcquired!: () => void;
    let releaseFirst!: () => void;
    const acquired = new Promise<void>((resolve) => {
      announceAcquired = resolve;
    });
    const holdFirst = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const firstCreate = storage.withSchedulingLocks(contextA, route, locks, async (locked) => {
      expect(await locked.hasProviderOverlap({ doctorId, startsAt, endsAt })).toBe(false);
      announceAcquired();
      await holdFirst;
      return locked.create(record);
    });
    await acquired;

    await expect(
      storage.withSchedulingLocks(contextA, route, locks, async (locked) => {
        if (await locked.hasProviderOverlap({ doctorId, startsAt, endsAt })) {
          throw new AppointmentScheduleConflictError();
        }
        return locked.create({ ...record, id: randomUUID() });
      }),
    ).rejects.toBeInstanceOf(AppointmentScheduleLockConflictError);

    releaseFirst();
    await expect(firstCreate).resolves.toMatchObject({ id: record.id });
    await expect(
      storage.withSchedulingLocks(contextA, route, locks, async (locked) => {
        if (await locked.hasProviderOverlap({ doctorId, startsAt, endsAt })) {
          throw new AppointmentScheduleConflictError();
        }
        return locked.create({ ...record, id: randomUUID() });
      }),
    ).rejects.toBeInstanceOf(AppointmentScheduleConflictError);

    await expect(
      storage.withSchedulingLocks(contextA, route, locks, async () => {
        throw new Error('intentional callback failure');
      }),
    ).rejects.toThrow('intentional callback failure');
    await expect(
      storage.withSchedulingLocks(contextA, route, locks, async () => 'lock released'),
    ).resolves.toBe('lock released');

    await expect(
      storage.withSchedulingLocks(contextA, route, locks, async (locked) => locked.create(record)),
    ).rejects.toBeInstanceOf(TenantStorageUnavailableError);
    await expect(
      storage.withSchedulingLocks(contextA, route, locks, async () => 'failed write released lock'),
    ).resolves.toBe('failed write released lock');

    const lockCollection = mongoAdminClient!
      .db(tenantA.databaseName)
      .collection('appointment_schedule_locks');
    const blockedFacilityId = randomUUID();
    const ownerToken = randomUUID();
    await lockCollection.insertOne({
      _tenantId: tenantA.id,
      resourceType: 'FACILITY',
      resourceId: blockedFacilityId,
      ownerToken,
      acquiredAt: new Date(),
    });
    const partialDoctorId = randomUUID();
    await expect(
      storage.withSchedulingLocks(
        contextA,
        route,
        [
          { resourceType: 'DOCTOR', resourceId: partialDoctorId },
          { resourceType: 'FACILITY', resourceId: blockedFacilityId },
        ],
        async () => undefined,
      ),
    ).rejects.toBeInstanceOf(AppointmentScheduleLockConflictError);
    await expect(
      storage.withSchedulingLocks(
        contextA,
        route,
        [{ resourceType: 'DOCTOR', resourceId: partialDoctorId }],
        async () => 'partial acquisition cleaned',
      ),
    ).resolves.toBe('partial acquisition cleaned');

    await expect(
      storage.withSchedulingLocks(
        contextA,
        route,
        [{ resourceType: 'FACILITY', resourceId: blockedFacilityId }],
        async () => undefined,
      ),
    ).rejects.toBeInstanceOf(AppointmentScheduleLockConflictError);
    await lockCollection.deleteOne({
      _tenantId: tenantA.id,
      resourceType: 'FACILITY',
      resourceId: blockedFacilityId,
      ownerToken,
    });

    await lockCollection.dropIndex('tenant_appointment_schedule_lock_unique');
    await expect(
      storage.withSchedulingLocks(contextA, route, locks, async () => undefined),
    ).rejects.toBeInstanceOf(TenantStorageUnavailableError);
    await storage.ensureIndexesForTarget(targetA);
  }, 60_000);

  it('serializes competing reschedules and cancellation with a new booking in real MongoDB', async () => {
    const storage = getApplication().get(MongoTenantAppointmentStorage);
    const route: TenantStorageRoute = {
      placements: [{ placementId: targetA.id as TenantStoragePlacementId }],
    };
    const doctorId = randomUUID();
    const facilityId = randomUUID();
    const locks = [
      { resourceType: 'DOCTOR' as const, resourceId: doctorId },
      { resourceType: 'FACILITY' as const, resourceId: facilityId },
    ];
    const createdAt = new Date('2026-10-19T12:00:00.000Z');
    const targetStart = new Date('2026-10-20T09:00:00.000Z');
    const targetEnd = new Date('2026-10-20T09:30:00.000Z');
    const existing = [
      {
        id: randomUUID(),
        startsAt: new Date('2026-10-20T08:00:00.000Z'),
        endsAt: new Date('2026-10-20T08:30:00.000Z'),
      },
      {
        id: randomUUID(),
        startsAt: new Date('2026-10-20T10:00:00.000Z'),
        endsAt: new Date('2026-10-20T10:30:00.000Z'),
      },
    ];
    for (const appointment of existing) {
      await storage.create(contextA, route, {
        ...appointment,
        patientId: randomUUID(),
        doctorId,
        facilityId,
        branchId: null,
        serviceId: null,
        status: 'SCHEDULED',
        reason: null,
        createdAt,
        updatedAt: createdAt,
        createdBy: platformUserId,
        updatedBy: platformUserId,
        cancelledAt: null,
        cancelledBy: null,
        version: 1,
      });
    }

    let announceReschedule!: () => void;
    let releaseReschedule!: () => void;
    const rescheduleAcquired = new Promise<void>((resolve) => {
      announceReschedule = resolve;
    });
    const holdReschedule = new Promise<void>((resolve) => {
      releaseReschedule = resolve;
    });
    const firstReschedule = storage.withSchedulingLocks(contextA, route, locks, async (locked) => {
      expect(
        await locked.hasProviderOverlap({
          doctorId,
          startsAt: targetStart,
          endsAt: targetEnd,
          excludeId: existing[0].id,
        }),
      ).toBe(false);
      announceReschedule();
      await holdReschedule;
      return locked.update(existing[0].id, 1, {
        startsAt: targetStart,
        endsAt: targetEnd,
        updatedAt: new Date(),
        updatedBy: platformUserId,
      });
    });
    await rescheduleAcquired;

    const competingReschedule = (): Promise<unknown> =>
      storage.withSchedulingLocks(contextA, route, locks, async (locked) => {
        if (
          await locked.hasProviderOverlap({
            doctorId,
            startsAt: targetStart,
            endsAt: targetEnd,
            excludeId: existing[1].id,
          })
        ) {
          throw new AppointmentScheduleConflictError();
        }
        return locked.update(existing[1].id, 1, {
          startsAt: targetStart,
          endsAt: targetEnd,
          updatedAt: new Date(),
          updatedBy: platformUserId,
        });
      });
    await expect(competingReschedule()).rejects.toBeInstanceOf(
      AppointmentScheduleLockConflictError,
    );
    releaseReschedule();
    await expect(firstReschedule).resolves.toMatchObject({
      id: existing[0].id,
      version: 2,
    });
    await expect(competingReschedule()).rejects.toBeInstanceOf(AppointmentScheduleConflictError);
    await expect(storage.findById(contextA, route, existing[1].id)).resolves.toMatchObject({
      startsAt: existing[1].startsAt,
      version: 1,
    });

    let announceCancellation!: () => void;
    let releaseCancellation!: () => void;
    const cancellationAcquired = new Promise<void>((resolve) => {
      announceCancellation = resolve;
    });
    const holdCancellation = new Promise<void>((resolve) => {
      releaseCancellation = resolve;
    });
    const cancellation = storage.withSchedulingLocks(contextA, route, locks, async (locked) => {
      const latest = await locked.findById(existing[0].id);
      expect(latest?.status).toBe('SCHEDULED');
      const updated = await locked.update(existing[0].id, latest!.version, {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelledBy: platformUserId,
        updatedAt: new Date(),
        updatedBy: platformUserId,
      });
      announceCancellation();
      await holdCancellation;
      return updated;
    });
    await cancellationAcquired;
    const newBooking = {
      id: randomUUID(),
      patientId: randomUUID(),
      doctorId,
      facilityId,
      branchId: null,
      serviceId: null,
      startsAt: targetStart,
      endsAt: targetEnd,
      status: 'SCHEDULED',
      reason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: platformUserId,
      updatedBy: platformUserId,
      cancelledAt: null,
      cancelledBy: null,
      version: 1,
    };
    const createBooking = (): Promise<unknown> =>
      storage.withSchedulingLocks(contextA, route, locks, async (locked) => {
        if (
          await locked.hasProviderOverlap({ doctorId, startsAt: targetStart, endsAt: targetEnd })
        ) {
          throw new AppointmentScheduleConflictError();
        }
        return locked.create(newBooking);
      });
    await expect(createBooking()).rejects.toBeInstanceOf(AppointmentScheduleLockConflictError);
    releaseCancellation();
    await expect(cancellation).resolves.toMatchObject({ status: 'CANCELLED', version: 3 });
    await expect(createBooking()).resolves.toMatchObject({ id: newBooking.id });
  }, 60_000);

  it('persists facility scheduling policy revisions and audit events in disposable MySQL', async () => {
    const prisma = getApplication().get(PrismaService);
    const facility = await prisma.facility.create({
      data: { tenantId: tenantA.id, name: `policy-${RUN_ID}` },
    });
    const actor = {
      userId: platformUserId,
      sessionId: platformSessionId,
      tokenVersion: 1,
      platformRoleIds: [],
    };
    const policies = getApplication().get(FacilitySchedulingPolicyService);
    const created = await policies.put(
      contextA,
      facility.id,
      { timeZone: 'UTC', rules: {} },
      actor,
    );
    expect(created).toMatchObject({ facilityId: facility.id, status: 'INACTIVE', version: 1 });

    const activated = await policies.activate(
      contextA,
      facility.id,
      { expectedVersion: created.version },
      actor,
    );
    expect(activated).toMatchObject({ status: 'ACTIVE', version: 2 });
    await expect(policies.effectiveTimeZone(contextA, facility.id)).resolves.toBe('UTC');
    await expect(
      policies.effectiveTimeZones(contextA, [facility.id, randomUUID()]),
    ).resolves.toEqual(new Map([[facility.id, 'UTC']]));
    await expect(
      policies.assertBookingAllowed(contextA, {
        facilityId: facility.id,
        doctorId: randomUUID(),
        serviceId: null,
        startsAt: new Date('2026-10-20T09:00:00.000Z'),
        endsAt: new Date('2026-10-20T09:30:00.000Z'),
      }),
    ).resolves.toBeUndefined();

    const deactivated = await policies.deactivate(
      contextA,
      facility.id,
      { expectedVersion: activated.version },
      actor,
    );
    expect(deactivated).toMatchObject({ status: 'INACTIVE', version: 3 });
    await expect(policies.effectiveTimeZone(contextA, facility.id)).resolves.toBeNull();
    await expect(policies.effectiveTimeZones(contextA, [facility.id])).resolves.toEqual(new Map());
    await expect(policies.history(contextA, facility.id)).resolves.toMatchObject({
      total: 3,
      items: [
        { version: 3, action: 'DEACTIVATED' },
        { version: 2, action: 'ACTIVATED' },
        { version: 1, action: 'CREATED' },
      ],
    });
    await expect(
      prisma.platformAuditLog.count({
        where: {
          subjectTenantId: tenantA.id,
          eventType: {
            in: [
              'SCHEDULING_POLICY_CREATED',
              'SCHEDULING_POLICY_ACTIVATED',
              'SCHEDULING_POLICY_DEACTIVATED',
            ],
          },
        },
      }),
    ).resolves.toBe(3);
  }, 60_000);

  it('rejects a tenant collection whose Patient-number index inherits non-simple default collation', async () => {
    const incompatibleTarget = {
      ...targetA,
      databaseName: `phase36_${RUN_ID}`,
    };
    const database = mongoAdminClient!.db(incompatibleTarget.databaseName);

    try {
      await database.createCollection(PATIENT_COLLECTION, {
        collation: { locale: 'en', strength: 2 },
      });

      await expect(
        getApplication().get(MongoTenantPatientStorage).ensureIndexesForTarget(incompatibleTarget),
      ).rejects.toBeInstanceOf(TenantStorageUnavailableError);
    } finally {
      await database.dropDatabase();
    }
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

    const activation = getApplication().get(TenantStorageActivationService);
    try {
      await activation.setTargetStatus(tenantA.id, targetA.id, TenantStorageTargetStatus.INACTIVE);
      const inactive = await getApplication().inject({
        method: 'GET',
        url: `${tenantRoot(tenantA)}/patients`,
        headers: bearerHeaders(),
      });
      expect(inactive.statusCode).toBe(503);
      expect(inactive.json()).toMatchObject({ error: { code: 'TENANT_STORAGE_NOT_CONFIGURED' } });

      await activation.setTargetStatus(tenantA.id, targetA.id, TenantStorageTargetStatus.ACTIVE);
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

  it('fails closed during a real disposable MySQL outage and recovers after connectivity returns', async () => {
    const prisma = getApplication().get(PrismaService) as InstanceType<typeof PrismaClient>;
    const administrator = new PrismaClient({
      datasources: { db: { url: mysqlRootUri } },
    });
    const authRoot = `/${APP_CONSTANTS.apiPrefix}/${APP_CONSTANTS.apiVersion}/auth`;
    const outageResponse = (response: {
      statusCode: number;
      json(): Record<string, unknown>;
    }): void => {
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({
        success: false,
        error: {
          code: 'DATABASE_UNAVAILABLE',
          message: 'A required database service is unavailable',
        },
      });
    };

    await administrator.$connect();
    const baselineLogin = await getApplication().inject({
      method: 'POST',
      url: `${authRoot}/login`,
      payload: { email: testEmail, password: testPassword },
    });
    expect(baselineLogin.statusCode).toBe(200);
    accessToken = baselineLogin.json<{ accessToken: string }>().accessToken;
    refreshCookie = cookiePair(baselineLogin.headers['set-cookie']);
    await prisma.$disconnect();
    try {
      await administrator.$executeRawUnsafe('SET GLOBAL offline_mode = ON');

      const liveness = await getApplication().inject({
        method: 'GET',
        url: `/${APP_CONSTANTS.apiPrefix}/health`,
      });
      const readiness = await getApplication().inject({
        method: 'GET',
        url: `/${APP_CONSTANTS.apiPrefix}/ready`,
      });
      const login = await getApplication().inject({
        method: 'POST',
        url: `${authRoot}/login`,
        payload: { email: testEmail, password: testPassword },
      });
      const refresh = await getApplication().inject({
        method: 'POST',
        url: `${authRoot}/refresh`,
        headers: { cookie: refreshCookie },
      });
      const logout = await getApplication().inject({
        method: 'POST',
        url: `${authRoot}/logout`,
        headers: bearerHeaders(),
      });
      const membership = await getApplication().inject({
        method: 'GET',
        url: `/${APP_CONSTANTS.apiPrefix}/${APP_CONSTANTS.apiVersion}/session/tenants`,
        headers: bearerHeaders(),
      });
      const protectedPatientRead = await getApplication().inject({
        method: 'GET',
        url: `${tenantRoot(tenantA)}/patients`,
        headers: bearerHeaders(),
      });

      expect(liveness.statusCode).toBe(200);
      expect(readiness.statusCode).toBe(503);
      outageResponse(login);
      outageResponse(refresh);
      outageResponse(logout);
      outageResponse(membership);
      outageResponse(protectedPatientRead);
      expect(refresh.headers['set-cookie']).toBeUndefined();
      const serialized = JSON.stringify([
        login.json(),
        refresh.json(),
        logout.json(),
        membership.json(),
        protectedPatientRead.json(),
      ]);
      expect(serialized).not.toMatch(/mysql:|phase30_test|password|SELECT|Prisma/u);
    } finally {
      await administrator.$executeRawUnsafe('SET GLOBAL offline_mode = OFF').catch(() => undefined);
      await prisma.$connect().catch(() => undefined);
      await administrator.$disconnect();
    }

    expect(await prisma.isReady()).toBe(true);
    const recoveredLogin = await getApplication().inject({
      method: 'POST',
      url: `${authRoot}/login`,
      payload: { email: testEmail, password: testPassword },
    });
    expect(recoveredLogin.statusCode).toBe(200);
    expect(
      (
        await getApplication().inject({
          method: 'GET',
          url: `${APP_CONSTANTS.apiPrefix}/${APP_CONSTANTS.apiVersion}/session/tenants`,
          headers: bearerHeaders(),
        })
      ).statusCode,
    ).toBe(200);
  });

  it('returns unavailable for real tenant MongoDB HTTP reads and writes, then recovers', async () => {
    const admin = mongoAdminClient?.db('admin');
    if (!admin) throw new Error('Disposable MongoDB administrator client is unavailable');
    const setOutage = async (): Promise<void> => {
      await admin.command({
        configureFailPoint: 'failCommand',
        mode: 'alwaysOn',
        data: {
          failCommands: [
            'find',
            'aggregate',
            'insert',
            'update',
            'findAndModify',
            'delete',
            'listIndexes',
          ],
          errorCode: 91,
        },
      });
    };
    const clearOutage = async (): Promise<void> => {
      await admin.command({
        configureFailPoint: 'failCommand',
        mode: 'off',
      });
    };
    const responses: Array<{ statusCode: number; body: string }> = [];
    await setOutage();
    try {
      responses.push(
        ...(await Promise.all([
          getApplication().inject({
            method: 'GET',
            url: `${tenantRoot(tenantA)}/patients/${clinicalPatientId}`,
            headers: bearerHeaders(),
          }),
          getApplication().inject({
            method: 'GET',
            url: `${tenantRoot(tenantA)}/patients?search=phase45c`,
            headers: bearerHeaders(),
          }),
          getApplication().inject({
            method: 'GET',
            url: `${tenantRoot(tenantA)}/patients/${clinicalPatientId}/encounters`,
            headers: bearerHeaders(),
          }),
          getApplication().inject({
            method: 'GET',
            url: `${tenantRoot(tenantA)}/appointments?facilityId=${clinicalFacilityId}&branchId=${clinicalBranchId}`,
            headers: bearerHeaders(),
          }),
          getApplication().inject({
            method: 'GET',
            url: `${tenantRoot(tenantA)}/encounters/${apiEncounterId}`,
            headers: bearerHeaders(),
          }),
          getApplication().inject({
            method: 'PATCH',
            url: `${tenantRoot(tenantA)}/encounters/${apiEncounterId}/clinical`,
            headers: bearerHeaders(),
            payload: { expectedVersion: 1, clinical: { assessment: 'outage probe' } },
          }),
          getApplication().inject({
            method: 'PUT',
            url: `${tenantRoot(tenantA)}/encounters/${apiEncounterId}/diagnoses`,
            headers: bearerHeaders(),
            payload: { expectedVersion: 1, diagnoses: [] },
          }),
          getApplication().inject({
            method: 'PUT',
            url: `${tenantRoot(tenantA)}/encounters/${apiEncounterId}/services`,
            headers: bearerHeaders(),
            payload: { expectedVersion: 1, serviceRecords: [] },
          }),
          getApplication().inject({
            method: 'POST',
            url: `${tenantRoot(tenantA)}/patients`,
            headers: bearerHeaders(),
            payload: patientPayload(`PH45C-${RUN_ID}`),
          }),
        ])),
      );
    } finally {
      await clearOutage();
    }

    expect(responses).toHaveLength(9);
    for (const response of responses) {
      expect(response.statusCode, response.body).toBe(503);
      expect(response.body).toContain('TENANT_STORAGE_UNAVAILABLE');
      expect(response.body).not.toContain('outage probe');
    }
    const recoveredList = await getApplication().inject({
      method: 'GET',
      url: `${tenantRoot(tenantA)}/patients`,
      headers: bearerHeaders(),
    });
    expect(recoveredList.statusCode, recoveredList.body).toBe(200);
    expect(recoveredList.json<{ items: Array<{ patientNumber: string }> }>().items).not.toContain(
      expect.objectContaining({ patientNumber: `PH45C-${RUN_ID}` }),
    );
  }, 120_000);

  it('cleans an ambiguously acknowledged schedule lock and retries appointment creation safely', async () => {
    const admin = mongoAdminClient?.db('admin');
    if (!admin) throw new Error('Disposable MongoDB administrator client is unavailable');
    const existing = await mongoAdminClient!
      .db(tenantA.databaseName)
      .collection('appointments')
      .findOne({ _id: browserAppointmentId, _tenantId: tenantA.id });
    if (!existing) throw new Error('Expected disposable appointment fixture is unavailable');
    const startsAt = new Date(new Date(existing.startsAt).getTime() + 30 * 60 * 1_000);
    const payload = {
      patientId: clinicalPatientId,
      doctorId: clinicalDoctorId,
      facilityId: clinicalFacilityId,
      branchId: clinicalBranchId,
      serviceId: clinicalServiceId,
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + 30 * 60 * 1_000).toISOString(),
    };
    const idempotencyKey = `phase45d-write-concern-${RUN_ID}`;

    // The first MongoDB insert in appointment creation acquires a schedule
    // lock. This server-injected write-concern error is not a network-level
    // lost acknowledgement on the later appointment-document insert.
    await admin.command({
      configureFailPoint: 'failCommand',
      mode: { times: 1 },
      data: {
        failCommands: ['insert'],
        appName: 'thanarah-tenant-storage',
        writeConcernError: {
          code: 64,
          errmsg: 'Phase 45D synthetic write concern acknowledgement loss',
        },
      },
    });
    let first;
    try {
      first = await getApplication().inject({
        method: 'POST',
        url: `${tenantRoot(tenantA)}/appointments`,
        headers: { ...bearerHeaders(), 'idempotency-key': idempotencyKey },
        payload,
      });
    } finally {
      await admin.command({ configureFailPoint: 'failCommand', mode: 'off' });
    }

    // A retryable write may return the original result or report the uncertain
    // write as unavailable. Both outcomes must be safe to reconcile by key.
    expect([201, 503]).toContain(first.statusCode);
    if (first.statusCode === 503) expect(first.body).toContain('TENANT_STORAGE_UNAVAILABLE');
    const appointmentCollection = mongoAdminClient!
      .db(tenantA.databaseName)
      .collection('appointments');
    const persistedAfterFirstAttempt = await appointmentCollection.findOne({
      _tenantId: tenantA.id,
      patientId: clinicalPatientId,
      doctorId: clinicalDoctorId,
      startsAt,
    });
    console.info('Phase 45D synthetic write-concern outcome', {
      responseStatus: first.statusCode,
      persistedBeforeRetry: persistedAfterFirstAttempt !== null,
    });
    if (first.statusCode === 201) expect(persistedAfterFirstAttempt).not.toBeNull();
    const retry = await getApplication().inject({
      method: 'POST',
      url: `${tenantRoot(tenantA)}/appointments`,
      headers: { ...bearerHeaders(), 'idempotency-key': idempotencyKey },
      payload,
    });
    expect(retry.statusCode, retry.body).toBe(201);
    const appointmentId = retry.json<{ id: string }>().id;
    if (persistedAfterFirstAttempt) expect(appointmentId).toBe(persistedAfterFirstAttempt._id);
    expect(
      await appointmentCollection.countDocuments({ _id: appointmentId, _tenantId: tenantA.id }),
    ).toBe(1);
    const createEncounterFromAppointment = (): ReturnType<NestFastifyApplication['inject']> =>
      getApplication().inject({
        method: 'POST',
        url: `${tenantRoot(tenantA)}/encounters/from-appointment`,
        headers: bearerHeaders(),
        payload: { appointmentId },
      });
    const [firstEncounter, secondEncounter] = await Promise.all([
      createEncounterFromAppointment(),
      createEncounterFromAppointment(),
    ]);
    const encounterResponses = [firstEncounter, secondEncounter];
    expect(encounterResponses.filter(({ statusCode }) => statusCode === 201)).toHaveLength(1);
    expect(encounterResponses.filter(({ statusCode }) => statusCode === 409)).toHaveLength(1);
    const linkedEncounters = await mongoAdminClient!
      .db(tenantA.databaseName)
      .collection('encounters')
      .countDocuments({
        _tenantId: tenantA.id,
        appointmentId,
        status: { $in: ['DRAFT', 'COMPLETED'] },
      });
    expect(linkedEncounters).toBe(1);
    const encounterRetry = await createEncounterFromAppointment();
    expect(encounterRetry.statusCode).toBe(409);
    expect(
      await mongoAdminClient!
        .db(tenantA.databaseName)
        .collection('encounters')
        .countDocuments({
          _tenantId: tenantA.id,
          appointmentId,
          status: { $in: ['DRAFT', 'COMPLETED'] },
        }),
    ).toBe(1);
    const changedPayload = {
      ...payload,
      startsAt: new Date(startsAt.getTime() + 60 * 60 * 1_000).toISOString(),
      endsAt: new Date(startsAt.getTime() + 90 * 60 * 1_000).toISOString(),
    };
    const conflictingRetry = await getApplication().inject({
      method: 'POST',
      url: `${tenantRoot(tenantA)}/appointments`,
      headers: { ...bearerHeaders(), 'idempotency-key': idempotencyKey },
      payload: changedPayload,
    });
    expect(conflictingRetry.statusCode).toBe(409);
    expect(
      await mongoAdminClient!
        .db(tenantA.databaseName)
        .collection('appointment_schedule_locks')
        .countDocuments({ _tenantId: tenantA.id }),
    ).toBe(0);
  }, 60_000);

  it('fails closed for encounter completion and amendment writes, then preserves and recovers state', async () => {
    const admin = mongoAdminClient?.db('admin');
    if (!admin) throw new Error('Disposable MongoDB administrator client is unavailable');
    const created = await getApplication().inject({
      method: 'POST',
      url: `${tenantRoot(tenantA)}/encounters/direct`,
      headers: bearerHeaders(),
      payload: {
        patientId: clinicalPatientId,
        doctorId: clinicalDoctorId,
        facilityId: clinicalFacilityId,
        branchId: clinicalBranchId,
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const encounterId = created.json<{ id: string }>().id;
    const collection = mongoAdminClient!.db(tenantA.databaseName).collection('encounters');
    const failOneWrite = async (): Promise<void> => {
      await admin.command({
        configureFailPoint: 'failCommand',
        mode: { times: 1 },
        data: { failCommands: ['findAndModify'], errorCode: 91 },
      });
    };
    const clearFailure = async (): Promise<void> => {
      await admin.command({ configureFailPoint: 'failCommand', mode: 'off' });
    };
    const waitForStorageRecovery = async (): Promise<void> => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const probe = await getApplication().inject({
          method: 'GET',
          url: `${tenantRoot(tenantA)}/encounters/${encounterId}`,
          headers: bearerHeaders(),
        });
        if (probe.statusCode === 200) return;
        await delay(250);
      }
      throw new Error('Disposable MongoDB client did not recover after clearing failCommand');
    };

    await failOneWrite();
    let completion;
    try {
      completion = await getApplication().inject({
        method: 'POST',
        url: `${tenantRoot(tenantA)}/encounters/${encounterId}/complete`,
        headers: bearerHeaders(),
        payload: { expectedVersion: 1 },
      });
    } finally {
      await clearFailure();
    }
    expect(completion.statusCode, completion.body).toBe(503);
    expect(await collection.findOne({ _id: encounterId, _tenantId: tenantA.id })).toMatchObject({
      status: 'DRAFT',
      version: 1,
      history: [{ action: 'CREATED' }],
    });
    await waitForStorageRecovery();
    const completed = await getApplication().inject({
      method: 'POST',
      url: `${tenantRoot(tenantA)}/encounters/${encounterId}/complete`,
      headers: bearerHeaders(),
      payload: { expectedVersion: 1 },
    });
    expect(completed.statusCode, completed.body).toBe(200);
    const completedVersion = completed.json<{ version: number }>().version;
    const original = await collection.findOne({ _id: encounterId, _tenantId: tenantA.id });

    await failOneWrite();
    let opening;
    try {
      opening = await getApplication().inject({
        method: 'POST',
        url: `${tenantRoot(tenantA)}/encounters/${encounterId}/amendments`,
        headers: bearerHeaders(),
        payload: { expectedVersion: completedVersion, reason: 'Phase 45D recovery check' },
      });
    } finally {
      await clearFailure();
    }
    expect(opening.statusCode, opening.body).toBe(503);
    expect(await collection.findOne({ _id: encounterId, _tenantId: tenantA.id })).toMatchObject({
      status: 'COMPLETED',
      version: completedVersion,
      amendments: [],
    });
    await waitForStorageRecovery();
    const amendment = await getApplication().inject({
      method: 'POST',
      url: `${tenantRoot(tenantA)}/encounters/${encounterId}/amendments`,
      headers: bearerHeaders(),
      payload: { expectedVersion: completedVersion, reason: 'Phase 45D recovery check' },
    });
    expect(amendment.statusCode, amendment.body).toBe(201);
    const amended = await collection.findOne({ _id: encounterId, _tenantId: tenantA.id });
    expect(amended?.clinical).toEqual(original?.clinical);
    expect(amended?.diagnoses).toEqual(original?.diagnoses);
    expect(amended?.serviceRecords).toEqual(original?.serviceRecords);
    expect(amended?.amendments).toHaveLength(1);
  }, 60_000);

  it('fails closed for Mongo authentication, invalid configuration, and unavailable servers', async () => {
    expect(getApplication().get(TENANT_PATIENT_STORAGE)).toBeInstanceOf(MongoTenantPatientStorage);
    const invalidMongoUri = mongoUri.replace(mongoPassword, `${mongoPassword}incorrect`);
    const authFailure = await patientListFailureForMongoUri(invalidMongoUri);
    const invalidConfigUri = 'not-a-mongodb-uri';
    const invalidConfigFailure = await patientListFailureForMongoUri(invalidConfigUri);
    const unavailableUri = 'mongodb://127.0.0.1:1/?directConnection=true';
    const unavailableFailure = await patientListFailureForMongoUri(unavailableUri);
    const unavailableWriteFailure = await patientCreateFailureForMongoUri(unavailableUri);

    for (const failure of [
      authFailure,
      invalidConfigFailure,
      unavailableFailure,
      unavailableWriteFailure,
    ]) {
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
      'tenant_patient_duplicate_phone_name_unique_idx',
      'tenant_patient_duplicate_email_name_unique_idx',
      'tenant_patient_duplicate_name_dob_unique_idx',
    ];
    for (const name of duplicateIndexNames) {
      expect(duplicateIndexes.find((index) => index.name === name)).toMatchObject({
        unique: true,
        collation: { locale: 'en', strength: 2 },
      });
      expect(
        duplicateIndexes.find((index) => index.name === name)?.partialFilterExpression,
      ).toBeDefined();
    }
    expect(
      duplicateIndexes.some((index) =>
        [
          'tenant_patient_duplicate_phone_name_idx',
          'tenant_patient_duplicate_email_name_idx',
          'tenant_patient_duplicate_name_dob_idx',
        ].includes(index.name ?? ''),
      ),
    ).toBe(false);
    const collectionNames = (
      await mongoAdminClient!.db(tenantA.databaseName).listCollections().toArray()
    ).map((collection) => collection.name);
    expect(collectionNames.some((name) => /claim|reservation/i.test(name))).toBe(false);

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

  it('enforces each duplicate rule across deterministic concurrent Mongo creates', async () => {
    const sharedFirst = `Concurrent${RUN_ID}`;
    const sharedLast = `Patient${RUN_ID}`;
    const sharedDate = '1991-07-12';
    const scenarios: Array<{
      payloads: [Record<string, unknown>, Record<string, unknown>];
      match: Record<string, unknown>;
    }> = [
      {
        payloads: [
          {
            firstName: sharedFirst,
            middleName: 'Phone Match',
            lastName: sharedLast,
            phone: '+966 50 700 0101',
          },
          {
            firstName: sharedFirst.toUpperCase(),
            middleName: 'phone match',
            lastName: sharedLast.toUpperCase(),
            phone: '+966 50 700 0101',
          },
        ],
        match: {
          firstName: sharedFirst,
          middleName: 'Phone Match',
          lastName: sharedLast,
          phone: '+966 50 700 0101',
        },
      },
      {
        payloads: [
          {
            firstName: `${sharedFirst}Email`,
            middleName: 'Email Match',
            lastName: sharedLast,
            email: `race-${RUN_ID}@example.test`,
          },
          {
            firstName: `${sharedFirst}EMAIL`.toUpperCase(),
            middleName: 'email match',
            lastName: sharedLast.toUpperCase(),
            email: `RACE-${RUN_ID}@EXAMPLE.TEST`,
          },
        ],
        match: {
          firstName: `${sharedFirst}Email`,
          middleName: 'Email Match',
          lastName: sharedLast,
          email: `race-${RUN_ID}@example.test`,
        },
      },
      {
        payloads: [
          {
            firstName: `${sharedFirst}Date`,
            middleName: 'Date A',
            lastName: sharedLast,
            dateOfBirth: sharedDate,
          },
          {
            firstName: `${sharedFirst}DATE`.toUpperCase(),
            middleName: 'Date B',
            lastName: sharedLast.toUpperCase(),
            dateOfBirth: sharedDate,
          },
        ],
        match: {
          firstName: `${sharedFirst}Date`,
          lastName: sharedLast,
          dateOfBirth: {
            $gte: new Date(`${sharedDate}T00:00:00.000Z`),
            $lt: new Date('1991-07-13T00:00:00.000Z'),
          },
        },
      },
    ];

    const patients = mongoAdminClient!.db(tenantA.databaseName).collection(PATIENT_COLLECTION);
    for (const [index, scenario] of scenarios.entries()) {
      const numbers = [`PAT33-RACE-${index}-A-${RUN_ID}`, `PAT33-RACE-${index}-B-${RUN_ID}`];
      const { result: responses, checks } = await withDuplicateCheckBarrier(2, () =>
        Promise.all(
          scenario.payloads.map((payload, requestIndex) =>
            getApplication().inject({
              method: 'POST',
              url: `${tenantRoot(tenantA)}/patients`,
              headers: bearerHeaders(),
              payload: { patientNumber: numbers[requestIndex]!, ...payload },
            }),
          ),
        ),
      );

      expect(checks).toEqual([false, false]);
      expect(responses.map((response) => response.statusCode).sort((a, b) => a - b)).toEqual([
        201, 409,
      ]);
      const conflict = responses.find((response) => response.statusCode === 409);
      expect(conflict?.json()).toMatchObject({
        error: {
          code: 'PATIENT_DUPLICATE_POSSIBLE',
          message: 'A possible matching patient already exists.',
        },
      });
      expect(JSON.stringify(conflict?.json())).not.toMatch(
        /patientNumber|patientId|firstName|lastName|phone|email|dateOfBirth/i,
      );
      await expect(
        patients.countDocuments(
          { _tenantId: tenantA.id, ...scenario.match },
          { collation: { locale: 'en', strength: 2 } },
        ),
      ).resolves.toBe(1);
    }
  });

  it('prevents concurrent identity-changing updates and preserves the losing patient identity', async () => {
    const startingPatients = [
      {
        patientNumber: `PAT33-UPDATE-A-${RUN_ID}`,
        firstName: `BeforeA${RUN_ID}`,
        middleName: 'Initial',
        lastName: `UpdateRace${RUN_ID}`,
        phone: '+966 50 711 0001',
      },
      {
        patientNumber: `PAT33-UPDATE-B-${RUN_ID}`,
        firstName: `BeforeB${RUN_ID}`,
        middleName: 'Initial',
        lastName: `UpdateRace${RUN_ID}`,
        phone: '+966 50 711 0002',
      },
    ];
    const created = await Promise.all(
      startingPatients.map((patient) =>
        getApplication().inject({
          method: 'POST',
          url: `${tenantRoot(tenantA)}/patients`,
          headers: bearerHeaders(),
          payload: patient,
        }),
      ),
    );
    expect(created.map((response) => response.statusCode)).toEqual([201, 201]);
    const patientIds = created.map((response) => response.json<{ id: string }>().id);
    const targetIdentity = {
      firstName: `UpdateTarget${RUN_ID}`,
      middleName: 'Shared',
      lastName: `UpdateRace${RUN_ID}`,
      phone: '+966 50 711 0099',
    };

    const { result: updates, checks } = await withDuplicateCheckBarrier(2, () =>
      Promise.all(
        patientIds.map((id) =>
          getApplication().inject({
            method: 'PATCH',
            url: `${tenantRoot(tenantA)}/patients/${id}`,
            headers: bearerHeaders(),
            payload: targetIdentity,
          }),
        ),
      ),
    );

    expect(checks).toEqual([false, false]);
    expect(updates.map((response) => response.statusCode).sort((a, b) => a - b)).toEqual([
      200, 409,
    ]);
    const losingIndex = updates.findIndex((response) => response.statusCode === 409);
    const losingPatient = await getApplication().inject({
      method: 'GET',
      url: `${tenantRoot(tenantA)}/patients/${patientIds[losingIndex]}`,
      headers: bearerHeaders(),
    });
    expect(losingPatient.statusCode).toBe(200);
    expect(losingPatient.json()).toMatchObject({
      firstName: startingPatients[losingIndex]!.firstName,
      middleName: startingPatients[losingIndex]!.middleName,
      lastName: startingPatients[losingIndex]!.lastName,
      phone: startingPatients[losingIndex]!.phone,
    });
    expect(
      await mongoAdminClient!
        .db(tenantA.databaseName)
        .collection(PATIENT_COLLECTION)
        .countDocuments(
          { _tenantId: tenantA.id, ...targetIdentity },
          { collation: { locale: 'en', strength: 2 } },
        ),
    ).toBe(1);

    const attemptedDuplicate = await getApplication().inject({
      method: 'POST',
      url: `${tenantRoot(tenantA)}/patients`,
      headers: bearerHeaders(),
      payload: {
        ...startingPatients[losingIndex],
        patientNumber: `PAT33-LOSER-IDENTITY-${RUN_ID}`,
      },
    });
    expect(attemptedDuplicate.statusCode).toBe(409);
    expect(attemptedDuplicate.json()).toMatchObject({
      error: { code: 'PATIENT_DUPLICATE_POSSIBLE' },
    });
  });

  it('preserves patient-number precedence and does not reserve identities after failed inserts', async () => {
    const repository = getApplication().get(TenantStoragePatientRepository);
    const numberOwner = {
      patientNumber: `PAT33-NUMBER-OWNER-${RUN_ID}`,
      firstName: `NumberOwner${RUN_ID}`,
      lastName: 'Existing',
    };
    const identityAfterFailure = {
      firstName: `RetryAfterFailure${RUN_ID}`,
      lastName: 'RetryPatient',
      phone: '+966 50 712 0001',
    };
    const numberOwnerResult = await repository.create(contextA, numberOwner);
    expect(numberOwnerResult.kind).toBe('changed');

    await expect(
      repository.create(contextA, {
        ...identityAfterFailure,
        patientNumber: numberOwner.patientNumber,
      }),
    ).resolves.toEqual({ kind: 'patient-number-conflict' });

    const retry = await repository.create(contextA, {
      ...identityAfterFailure,
      patientNumber: `PAT33-RETRY-${RUN_ID}`,
    });
    expect(retry.kind).toBe('changed');

    const identityOwner = await repository.create(contextA, {
      patientNumber: `PAT33-IDENTITY-OWNER-${RUN_ID}`,
      firstName: `IdentityOwner${RUN_ID}`,
      lastName: 'Existing',
      phone: '+966 50 712 0002',
    });
    expect(identityOwner.kind).toBe('changed');
    await expect(
      repository.create(contextA, {
        patientNumber: numberOwner.patientNumber,
        firstName: `IdentityOwner${RUN_ID}`,
        lastName: 'Existing',
        phone: '+966 50 712 0002',
      }),
    ).resolves.toEqual({ kind: 'patient-number-conflict' });
  });

  it('fails Patient writes closed when an atomic duplicate index is missing', async () => {
    const patients = mongoAdminClient!.db(tenantA.databaseName).collection(PATIENT_COLLECTION);
    const indexName = 'tenant_patient_duplicate_phone_name_unique_idx';
    await patients.dropIndex(indexName);
    const patientNumber = `PAT33-NO-INDEX-${RUN_ID}`;

    try {
      const response = await getApplication().inject({
        method: 'POST',
        url: `${tenantRoot(tenantA)}/patients`,
        headers: bearerHeaders(),
        payload: {
          patientNumber,
          firstName: `NoIndex${RUN_ID}`,
          lastName: 'Blocked',
          phone: '+966 50 713 0001',
        },
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({
        error: { code: 'TENANT_STORAGE_UNAVAILABLE' },
      });
      expect(JSON.stringify(response.json())).not.toMatch(
        /patientNumber|firstName|lastName|phone|databaseName/i,
      );
      await expect(patients.countDocuments({ _tenantId: tenantA.id, patientNumber })).resolves.toBe(
        0,
      );
    } finally {
      await getApplication().get(MongoTenantPatientStorage).ensureIndexesForTarget(targetA);
    }
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

async function patientCreateFailureForMongoUri(
  uri: string,
): Promise<TenantStorageUnavailableError> {
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
    await repository.create(contextA, {
      patientNumber: `PAT33-UNAVAILABLE-${RUN_ID}`,
      firstName: 'Unavailable',
      lastName: 'Storage',
      phone: '+966 50 799 0001',
    });
  } catch (error) {
    if (error instanceof TenantStorageUnavailableError) return error;
    throw error;
  } finally {
    await manager.onApplicationShutdown();
  }

  throw new Error('Expected Patient storage create to fail closed');
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

async function withDuplicateCheckBarrier<T>(
  expectedChecks: number,
  operation: () => Promise<T>,
): Promise<{ result: T; checks: boolean[] }> {
  const repository = getApplication().get(TenantStoragePatientRepository);
  const original = repository.findPotentialDuplicates;
  const checks: boolean[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolveGate) => {
    release = resolveGate;
  });
  const timeout = setTimeout(release, 15_000);
  repository.findPotentialDuplicates = async (...args: unknown[]): Promise<boolean> => {
    const duplicate = (await original.apply(repository, args)) as boolean;
    checks.push(duplicate);
    if (checks.length === expectedChecks) release();
    await gate;
    return duplicate;
  };

  try {
    const result = await operation();
    return { result, checks };
  } finally {
    clearTimeout(timeout);
    release();
    repository.findPotentialDuplicates = original;
  }
}

async function createApplication(): Promise<void> {
  const { AppModule } = requireFromWorkspace('../dist/app.module');
  const testingModule: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(TENANT_MONGO_CLIENT_FACTORY)
    .useValue(mongoFactory)
    .compile();
  application = testingModule.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  application.setGlobalPrefix(APP_CONSTANTS.apiPrefix);
  await application.register(cookie);
  await application.register(fastifyStatic, {
    root: join(process.cwd(), 'public'),
    prefix: '/',
    decorateReply: false,
  });
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
      email: testEmail,
      passwordHash: await getApplication().get(PasswordHasherService).hash(testPassword),
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

  const encounterPermissionCodes = [
    'tenant.facilities.read',
    'tenant.branches.read',
    'tenant.doctors.read',
    'tenant.services.read',
    'tenant.appointments.create',
    'tenant.appointments.read',
    'tenant.appointments.reschedule',
    'tenant.encounters.create',
    'tenant.encounters.create.direct',
    'tenant.encounters.read',
    'tenant.encounters.patient-history.read',
    'tenant.encounters.clinical.write',
    'tenant.encounters.complete',
    'tenant.encounters.cancel',
    'tenant.encounters.history.read',
    'tenant.encounters.diagnoses.read',
    'tenant.encounters.diagnoses.write',
    'tenant.encounters.services.read',
    'tenant.encounters.services.write',
    'tenant.encounters.amendments.create',
    'tenant.encounters.amendments.update',
    'tenant.encounters.amendments.finalize',
  ];
  const encounterPermissions = await prisma.tenantPermission.findMany({
    where: { code: { in: encounterPermissionCodes } },
  });
  if (encounterPermissions.length !== encounterPermissionCodes.length) {
    throw new Error('Phase 42 encounter permission catalog is incomplete in disposable migrations');
  }
  await prisma.tenantRolePermission.createMany({
    data: encounterPermissions.map(({ id }) => ({
      tenantRoleId: tenantA.roleId,
      tenantPermissionId: id,
    })),
    skipDuplicates: true,
  });

  limitedUserId = randomUUID();
  limitedUserEmail = `phase44-appointments-only-${RUN_ID}@example.test`;
  limitedUserPassword = randomBytes(24).toString('base64url');
  const limitedMembershipId = randomUUID();
  const limitedRoleId = randomUUID();
  await prisma.user.create({
    data: {
      id: limitedUserId,
      email: limitedUserEmail,
      passwordHash: await getApplication().get(PasswordHasherService).hash(limitedUserPassword),
      fullName: 'Phase 44 Appointments-Only User',
      status: UserStatus.ACTIVE,
    },
  });
  await prisma.tenantMembership.create({
    data: {
      id: limitedMembershipId,
      tenantId: tenantA.id,
      platformUserId: limitedUserId,
      status: TenantMembershipStatus.ACTIVE,
      activatedAt: now,
    },
  });
  await prisma.tenantRole.create({
    data: {
      id: limitedRoleId,
      tenantId: tenantA.id,
      code: `PHASE44_APPOINTMENTS_ONLY_${RUN_ID.toUpperCase()}`,
      name: 'Phase 44 appointments-only role',
    },
  });
  const appointmentsReadPermission = encounterPermissions.find(
    ({ code }) => code === 'tenant.appointments.read',
  );
  if (!appointmentsReadPermission) {
    throw new Error('Appointment-read permission is missing from disposable migrations');
  }
  await prisma.tenantRolePermission.create({
    data: {
      tenantRoleId: limitedRoleId,
      tenantPermissionId: appointmentsReadPermission.id,
    },
  });
  await prisma.tenantMembershipRole.create({
    data: {
      tenantId: tenantA.id,
      membershipId: limitedMembershipId,
      tenantRoleId: limitedRoleId,
    },
  });

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

async function seedClinicalFixtures(prisma: PrismaService): Promise<void> {
  const facility = await prisma.facility.create({
    data: { tenantId: tenantA.id, name: `Phase 42 Clinic ${RUN_ID}` },
  });
  clinicalFacilityId = facility.id;
  const branch = await prisma.branch.create({
    data: { facilityId: facility.id, name: `Assigned Branch ${RUN_ID}` },
  });
  clinicalBranchId = branch.id;
  const unassignedBranch = await prisma.branch.create({
    data: { facilityId: facility.id, name: `Unassigned Branch ${RUN_ID}` },
  });
  unassignedBranchId = unassignedBranch.id;

  const staffA = await prisma.staff.create({
    data: {
      tenantId: tenantA.id,
      userId: platformUserId,
      membershipId: tenantA.membershipId,
      displayName: 'Phase 42 Clinician A',
      jobTitle: 'Clinician',
    },
  });
  const doctorA = await prisma.doctor.create({
    data: {
      tenantId: tenantA.id,
      staffId: staffA.id,
      professionalDisplayName: 'Phase 42 Clinician A',
      professionalTitle: 'Clinician',
      status: StaffStatus.ACTIVE,
    },
  });
  clinicalDoctorId = doctorA.id;
  await prisma.staffBranchAssignment.create({
    data: {
      tenantId: tenantA.id,
      staffId: staffA.id,
      facilityId: facility.id,
      branchId: branch.id,
    },
  });

  const serviceA = await prisma.service.create({
    data: {
      tenantId: tenantA.id,
      name: `Phase 42 Imaging ${RUN_ID}`,
      code: `XR-${RUN_ID.slice(0, 8)}`,
      description: 'Disposable integration catalog item',
    },
  });
  clinicalServiceId = serviceA.id;
  const serviceB = await prisma.service.create({
    data: {
      tenantId: tenantB.id,
      name: `Other Tenant Service ${RUN_ID}`,
      code: `OT-${RUN_ID.slice(0, 8)}`,
    },
  });
  otherTenantServiceId = serviceB.id;

  const staffB = await prisma.staff.create({
    data: {
      tenantId: tenantB.id,
      userId: platformUserId,
      membershipId: tenantB.membershipId,
      displayName: 'Other Tenant Clinician',
      jobTitle: 'Clinician',
    },
  });
  const doctorB = await prisma.doctor.create({
    data: {
      tenantId: tenantB.id,
      staffId: staffB.id,
      professionalDisplayName: 'Other Tenant Clinician',
      professionalTitle: 'Clinician',
      status: StaffStatus.ACTIVE,
    },
  });
  otherTenantDoctorId = doctorB.id;

  await prisma.facilitySchedulingPolicy.create({
    data: {
      tenantId: tenantA.id,
      facilityId: facility.id,
      status: FacilitySchedulingPolicyStatus.ACTIVE,
      timeZone: 'Asia/Riyadh',
      rules: {
        operatingHours: {},
        providerAvailability: [],
        allowedDurationsMinutes: [15, 30],
        serviceDurationRules: [],
        bookingHorizonDays: null,
        minimumAdvanceNoticeMinutes: null,
        minimumCancellationNoticeMinutes: null,
        minimumRescheduleNoticeMinutes: null,
      },
      version: 1,
    },
  });
}

async function provisionTenantTarget(tenant: TestTenant): Promise<void> {
  await mongoAdminClient!.db(tenant.databaseName).createCollection(PATIENT_COLLECTION);
  const registry = getApplication().get(TenantStorageRegistryService);
  const activation = getApplication().get(TenantStorageActivationService);
  const target = await registry.registerTarget(tenant.id, tenant.databaseName);
  await activation.setTargetStatus(tenant.id, target.id, TenantStorageTargetStatus.ACTIVE);
  const primaryTarget = await activation.setPrimaryTarget(tenant.id, target.id);
  if (!primaryTarget) throw new Error('Could not activate the disposable tenant storage target');
  if (tenant === tenantA) targetA = primaryTarget;
  else targetB = primaryTarget;
}

async function restorePrimaryTargetA(): Promise<void> {
  const prisma = getApplication().get(PrismaService);
  const activation = getApplication().get(TenantStorageActivationService);
  const existing = await prisma.tenantStorageTarget.findFirst({
    where: { tenantId: tenantA.id, connectionReference: 'primary' },
  });
  if (existing) {
    await activation.setTargetStatus(tenantA.id, existing.id, TenantStorageTargetStatus.INACTIVE);
    await prisma.tenantStorageTarget.update({
      where: { id: existing.id },
      data: { databaseName: tenantA.databaseName, isPrimary: false },
    });
    const activeTarget = await activation.setTargetStatus(
      tenantA.id,
      existing.id,
      TenantStorageTargetStatus.ACTIVE,
    );
    if (!activeTarget) throw new Error('Could not reactivate the disposable tenant storage target');
    const primaryTarget = await activation.setPrimaryTarget(tenantA.id, existing.id);
    if (!primaryTarget) throw new Error('Could not restore the disposable primary target');
    targetA = primaryTarget;
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

function cookiePair(value: string | string[] | undefined): string {
  const entries = Array.isArray(value) ? value : value ? [value] : [];
  const refreshCookie = entries.find((entry) => entry.startsWith('phase30_refresh='));
  if (!refreshCookie)
    throw new Error('Disposable authentication response omitted its refresh cookie');
  return refreshCookie.split(';', 1)[0]!;
}

function bearerHeaders(): { authorization: string } {
  return { authorization: `Bearer ${accessToken}` };
}

type CdpReply = {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { message?: string };
};

type CdpClient = {
  events: CdpReply[];
  send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  close(): void;
};

async function connectCdp(url: string): Promise<CdpClient> {
  const socket = new WebSocket(url);
  await new Promise<void>((resolvePromise, rejectPromise) => {
    socket.addEventListener('open', () => resolvePromise(), { once: true });
    socket.addEventListener(
      'error',
      () => rejectPromise(new Error('Could not connect to Chromium CDP')),
      {
        once: true,
      },
    );
  });

  let nextId = 0;
  const pending = new Map<
    number,
    { resolve: (reply: CdpReply) => void; reject: (error: Error) => void }
  >();
  const events: CdpReply[] = [];
  socket.addEventListener('message', (event) => {
    const reply = JSON.parse(String(event.data)) as CdpReply;
    if (reply.id === undefined) {
      events.push(reply);
      return;
    }
    const request = pending.get(reply.id);
    if (!request) return;
    pending.delete(reply.id);
    if (reply.error)
      request.reject(new Error(reply.error.message ?? 'Chromium CDP request failed'));
    else request.resolve(reply);
  });

  return {
    events,
    send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
      const id = ++nextId;
      return new Promise<Record<string, unknown>>((resolvePromise, rejectPromise) => {
        pending.set(id, {
          resolve: (reply) => resolvePromise(reply.result ?? {}),
          reject: rejectPromise,
        });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close(): void {
      socket.close();
    },
  };
}

async function evaluateBrowser(client: CdpClient, expression: string): Promise<unknown> {
  const response = await client.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (response.exceptionDetails) throw new Error('Chromium evaluation failed');
  const remoteResult = response.result as { value?: unknown } | undefined;
  return remoteResult?.value;
}

async function waitForBrowserCondition(
  client: CdpClient,
  expression: string,
  description: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await evaluateBrowser(client, expression)) return;
    await delay(100);
  }
  const visibleText = await evaluateBrowser(client, 'document.body.innerText');
  const worklistState = await evaluateBrowser(
    client,
    `JSON.stringify({
      encounterButtons: document.querySelectorAll('button[data-action="open-encounter"]').length,
      resultCount: document.querySelector('.encounter-card .encounter-workspace-name')?.textContent,
      emptyNotice: document.querySelector('.encounter-empty')?.innerText,
      listText: document.querySelector('.encounter-list')?.innerText,
      facilityId: document.querySelector('form[data-form="filters"] [name="facilityId"]')?.value,
      branchId: document.querySelector('form[data-form="filters"] [name="branchId"]')?.value,
      fromDate: document.querySelector('form[data-form="filters"] [name="date"]')?.value
    })`,
  );
  throw new Error(
    `Timed out waiting for ${description} in the signed-in browser. State: ${worklistState}. Visible text: ${String(visibleText).slice(0, 1_200)}`,
  );
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
