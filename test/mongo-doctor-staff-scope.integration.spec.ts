import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import type { Db, Document, Collection } from 'mongodb';
import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import type { ConfigService } from '../src/config/config.service';
import {
  PlatformMongoClientManager,
  OfficialPlatformMongoClientFactory,
} from '../src/platform-mongo/platform-mongo.client.manager';
import { provisionPlatformMongoIndexes } from '../src/platform-mongo/platform-mongo.indexes';
import { MongoTenantStaffScopeRepository } from '../src/platform-mongo/mongo-tenant-staff-scope.repository';
import { MongoDoctorRepository } from '../src/platform-mongo/mongo-doctor.repository';
import { documentTimestamps } from '../src/platform-mongo/platform-mongo.models';

const uri = process.env.PHASE65_PLATFORM_MONGO_URI;
const base = process.env.PHASE65_PLATFORM_MONGO_DATABASE;
const integration = uri && base ? describe : describe.skip;
integration('Mongo doctor and staff scope contracts', () => {
  let db: Db;
  let client: MongoClient;
  let manager: PlatformMongoClientManager;
  let scopes: MongoTenantStaffScopeRepository;
  let doctors: MongoDoctorRepository;
  const ids = Object.fromEntries(
    [
      'tenant',
      'other',
      'actor',
      'target',
      'actorMembership',
      'membership',
      'staff',
      'staff2',
      'facility',
      'otherFacility',
      'branch',
      'department',
      'specialty',
      'service',
    ].map((key) => [key, randomUUID()]),
  );
  const collection = (name: string): Collection<Document & { _id: string }> =>
    db.collection<Document & { _id: string }>(name);
  const scopeInput = (): Omit<
    Parameters<MongoTenantStaffScopeRepository['assignFacility']>[0],
    'facilityId'
  > => ({
    tenantId: ids.tenant,
    actorMembershipId: ids.actorMembership,
    actorPlatformUserId: ids.actor,
    staffId: ids.staff,
  });
  const createDoctor = (): ReturnType<MongoDoctorRepository['create']> =>
    doctors.create(ids.tenant, {
      staffId: ids.staff,
      professionalDisplayName: 'Synthetic doctor',
      departmentIds: [ids.department],
      specialtyIds: [ids.specialty],
    });
  const serviceInput = (): Parameters<MongoDoctorRepository['assignService']>[2] => ({
    serviceId: ids.service,
    facilityId: ids.facility,
    branchId: ids.branch,
  });
  async function doctorId(): Promise<string> {
    const result = await createDoctor();
    if (result.kind !== 'created') throw new Error('Synthetic doctor creation failed');
    return result.doctor.id;
  }

  beforeAll(async () => {
    if (
      !uri ||
      !base ||
      !/^mongodb:\/\/127\.0\.0\.1:45271,127\.0\.0\.1:45272,127\.0\.0\.1:45273\/\?replicaSet=rs0&retryWrites=true$/u.test(
        uri,
      ) ||
      !/^phase65_platform_[a-zA-Z0-9_]+$/u.test(base)
    ) {
      throw new Error('Only the disposable loopback replica set is allowed');
    }
    client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    db = client.db(`${base}_doctor_scope`);
    manager = new PlatformMongoClientManager(
      { platformMongoUri: uri, platformMongoDatabase: db.databaseName } as ConfigService,
      new OfficialPlatformMongoClientFactory(),
    );
    scopes = new MongoTenantStaffScopeRepository(manager);
    doctors = new MongoDoctorRepository(manager);
    await provisionPlatformMongoIndexes(db);
  }, 30_000);

  beforeEach(async () => {
    for (const name of [
      'tenants',
      'platform_users',
      'tenant_memberships',
      'tenant_staff',
      'facilities',
      'branches',
      'departments',
      'specialties',
      'services',
      'tenant_staff_scope_assignments',
      'doctors',
      'doctor_service_assignments',
    ])
      await collection(name).deleteMany({});
    const now = new Date();
    const common = { ...documentTimestamps(now), schemaVersion: 1 };
    const lifecycle = {
      status: 'ACTIVE',
      statusChangedAt: now,
      suspendedAt: null,
      deactivatedAt: null,
    };
    for (const id of [ids.tenant, ids.other])
      await collection('tenants').insertOne({
        _id: id,
        ...common,
        ...lifecycle,
        slug: id,
        legalName: 'Synthetic',
        displayName: 'Synthetic',
      });
    for (const [userId, membershipId] of [
      [ids.actor, ids.actorMembership],
      [ids.target, ids.membership],
    ]) {
      await collection('platform_users').insertOne({
        _id: userId,
        ...common,
        email: `${userId}@example.test`,
        fullName: 'Synthetic',
        passwordHash: 'not-a-login-hash',
        status: 'ACTIVE',
        tokenVersion: 0,
        failedLoginAttempts: 0,
        lockedUntil: null,
      });
      await collection('tenant_memberships').insertOne({
        _id: membershipId,
        ...common,
        tenantId: ids.tenant,
        platformUserId: userId,
        status: 'ACTIVE',
        statusChangedAt: now,
        activatedAt: now,
        suspendedAt: null,
        removedAt: null,
      });
    }
    await collection('tenant_staff').insertOne({
      _id: ids.staff,
      ...common,
      ...lifecycle,
      tenantId: ids.tenant,
      userId: ids.target,
      membershipId: ids.membership,
      displayName: 'Synthetic staff',
      jobTitle: null,
    });
    for (const [id, tenantId] of [
      [ids.facility, ids.tenant],
      [ids.otherFacility, ids.other],
    ])
      await collection('facilities').insertOne({
        _id: id,
        ...common,
        ...lifecycle,
        tenantId,
        name: 'Synthetic facility',
      });
    await collection('branches').insertOne({
      _id: ids.branch,
      ...common,
      ...lifecycle,
      facilityId: ids.facility,
      name: 'Synthetic branch',
    });
    for (const [name, id] of [
      ['departments', ids.department],
      ['specialties', ids.specialty],
    ])
      await collection(name).insertOne({
        _id: id,
        ...common,
        tenantId: ids.tenant,
        name: 'Synthetic catalog',
        description: null,
        ...lifecycle,
      });
    await collection('services').insertOne({
      _id: ids.service,
      ...common,
      tenantId: ids.tenant,
      name: 'Synthetic service',
      ...lifecycle,
      code: null,
      description: null,
    });
  });

  afterAll(async () => {
    try {
      if (db) await db.dropDatabase();
    } finally {
      await manager?.onApplicationShutdown();
      await client?.close();
    }
  });

  it('assigns, lists and independently removes facility and branch scopes idempotently', async () => {
    expect(
      await scopes.assignFacility({ ...scopeInput(), facilityId: ids.facility }),
    ).toMatchObject({ kind: 'changed', assignment: { staff: { userId: ids.target } } });
    expect(
      await scopes.assignFacility({ ...scopeInput(), facilityId: ids.facility }),
    ).toMatchObject({ kind: 'already-assigned' });
    expect(await scopes.assignBranch({ ...scopeInput(), branchId: ids.branch })).toMatchObject({
      kind: 'changed',
    });
    expect(await scopes.listFacilitiesForStaff(ids.tenant, ids.staff)).toHaveLength(1);
    expect(await scopes.listBranchesForStaff(ids.tenant, ids.staff)).toHaveLength(1);
    expect(
      await scopes.removeFacility({ ...scopeInput(), facilityId: ids.facility }),
    ).toMatchObject({ kind: 'changed' });
    expect(await scopes.removeFacility({ ...scopeInput(), facilityId: ids.facility })).toEqual({
      kind: 'not-assigned',
    });
    expect((await scopes.resolveEffectiveScope(ids.tenant, ids.staff))?.branches).toHaveLength(1);
    expect(await scopes.removeBranch({ ...scopeInput(), branchId: ids.branch })).toMatchObject({
      kind: 'changed',
    });
  });

  it('isolates tenants and rejects spoofed actors, missing targets and inactive units', async () => {
    expect(await scopes.assignFacility({ ...scopeInput(), facilityId: ids.otherFacility })).toEqual(
      { kind: 'not-found' },
    );
    expect(
      await scopes.assignBranch({
        ...scopeInput(),
        actorPlatformUserId: ids.target,
        branchId: ids.branch,
      }),
    ).toEqual({ kind: 'actor-ineligible' });
    expect(await scopes.listFacilitiesForStaff(ids.other, ids.staff)).toBeNull();
    await collection('facilities').updateOne(
      { _id: ids.facility },
      { $set: { status: 'SUSPENDED' } },
    );
    expect(await scopes.assignBranch({ ...scopeInput(), branchId: ids.branch })).toEqual({
      kind: 'unit-ineligible',
    });
  });

  it('filters inactive references and staff identities from effective scope', async () => {
    await scopes.assignFacility({ ...scopeInput(), facilityId: ids.facility });
    await scopes.assignBranch({ ...scopeInput(), branchId: ids.branch });
    await collection('branches').updateOne({ _id: ids.branch }, { $set: { status: 'SUSPENDED' } });
    expect(
      await scopes.resolveMembershipScope(ids.tenant, ids.membership, ids.target),
    ).toMatchObject({ facilities: [{ id: ids.facility }], branches: [] });
    await collection('platform_users').updateOne(
      { _id: ids.target },
      { $set: { status: 'INACTIVE' } },
    );
    expect(await scopes.resolveEffectiveScope(ids.tenant, ids.staff)).toEqual({
      facilities: [],
      branches: [],
    });
    expect(await scopes.assignFacility({ ...scopeInput(), facilityId: ids.facility })).toEqual({
      kind: 'staff-ineligible',
    });
  });

  it('distinguishes absent staff from an ineligible membership without granting scope', async () => {
    expect(
      await scopes.resolveMembershipScope(ids.tenant, ids.actorMembership, ids.actor),
    ).toBeNull();
    expect(await scopes.resolveMembershipScope(ids.tenant, ids.membership, ids.actor)).toEqual({
      facilities: [],
      branches: [],
    });
  });

  it('serializes concurrent grants without duplicate scopes', async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        scopes.assignBranch({ ...scopeInput(), branchId: ids.branch }),
      ),
    );
    expect(results.filter((result) => result.kind === 'changed')).toHaveLength(1);
    expect(results.filter((result) => result.kind === 'already-assigned')).toHaveLength(3);
  });

  it('creates a doctor with independent catalog links and enforces one doctor per staff', async () => {
    const result = await createDoctor();
    expect(result).toMatchObject({
      kind: 'created',
      doctor: {
        staff: { id: ids.staff },
        departmentAssignments: [{ department: { id: ids.department } }],
        specialtyAssignments: [{ specialty: { id: ids.specialty } }],
      },
    });
    expect(await createDoctor()).toEqual({ kind: 'already-exists' });
    expect(
      await doctors.findByIdForTenant(
        ids.other,
        result.kind === 'created' ? result.doctor.id : randomUUID(),
      ),
    ).toBeNull();
  });

  it('rejects missing, cross-tenant and inactive doctor references without partial writes', async () => {
    expect(await doctors.create(ids.other, { staffId: ids.staff })).toEqual({
      kind: 'staff-not-found',
    });
    expect(
      await doctors.create(ids.tenant, { staffId: ids.staff, departmentIds: [randomUUID()] }),
    ).toEqual({ kind: 'assignment-target-not-found' });
    expect(await collection('doctors').countDocuments({})).toBe(0);
    await collection('tenant_staff').updateOne(
      { _id: ids.staff },
      { $set: { status: 'SUSPENDED' } },
    );
    expect(await createDoctor()).toEqual({ kind: 'staff-ineligible' });
  });

  it('updates doctor presentation and catalog links without coupling departments to specialties', async () => {
    const id = await doctorId();
    expect(await doctors.unassignDepartment(ids.tenant, id, ids.department)).toMatchObject({
      kind: 'changed',
      doctor: {
        departmentAssignments: [],
        specialtyAssignments: [{ specialty: { id: ids.specialty } }],
      },
    });
    expect(await doctors.assignDepartment(ids.tenant, id, ids.department)).toMatchObject({
      kind: 'changed',
    });
    expect(await doctors.assignDepartment(ids.tenant, id, ids.department)).toEqual({
      kind: 'assignment-conflict',
    });
    expect(await doctors.unassignSpecialty(ids.tenant, id, ids.specialty)).toMatchObject({
      kind: 'changed',
    });
    expect(
      await doctors.updateForTenant(ids.tenant, id, {
        professionalTitle: 'Synthetic title',
        bio: 'Synthetic bio',
      }),
    ).toMatchObject({ kind: 'changed', doctor: { professionalTitle: 'Synthetic title' } });
  });

  it('performs status CAS and excludes inactive tenants from listing and mutations', async () => {
    const id = await doctorId();
    expect(
      await doctors.changeStatusIfCurrent(ids.tenant, id, 'ACTIVE', 'SUSPENDED', new Date()),
    ).toMatchObject({ kind: 'changed' });
    expect(
      await doctors.changeStatusIfCurrent(ids.tenant, id, 'ACTIVE', 'DEACTIVATED', new Date()),
    ).toEqual({ kind: 'not-changed' });
    expect(
      await doctors.listForTenant(ids.tenant, { status: 'SUSPENDED', limit: 10, offset: 0 }),
    ).toHaveLength(1);
    await collection('tenants').updateOne({ _id: ids.tenant }, { $set: { status: 'SUSPENDED' } });
    expect(await doctors.listForTenant(ids.tenant, { limit: 10, offset: 0 })).toEqual([]);
    expect(await doctors.updateForTenant(ids.tenant, id, { bio: null })).toEqual({
      kind: 'tenant-inactive',
    });
  });

  it('requires staff scope for doctor services and supports branch and facility inheritance', async () => {
    const id = await doctorId();
    expect(await doctors.assignService(ids.tenant, id, serviceInput())).toEqual({
      kind: 'doctor-out-of-scope',
    });
    await scopes.assignBranch({ ...scopeInput(), branchId: ids.branch });
    expect(await doctors.assignService(ids.tenant, id, serviceInput())).toMatchObject({
      kind: 'changed',
      assignment: { branchId: ids.branch },
    });
    expect(
      await doctors.hasServiceAssignment(ids.tenant, id, ids.service, ids.facility, ids.branch),
    ).toBe(true);
    expect(
      await doctors.hasServiceAssignment(ids.tenant, id, ids.service, ids.facility, null),
    ).toBe(false);
    expect(await doctors.assignService(ids.tenant, id, serviceInput())).toEqual({
      kind: 'assignment-conflict',
    });
    expect(await doctors.listServiceAssignments(ids.tenant, id)).toHaveLength(1);
    expect(await doctors.unassignService(ids.tenant, id, serviceInput())).toMatchObject({
      kind: 'changed',
    });
    expect(await doctors.unassignService(ids.tenant, id, serviceInput())).toEqual({
      kind: 'assignment-not-found',
    });
    await scopes.assignFacility({ ...scopeInput(), facilityId: ids.facility });
    expect(
      await doctors.assignService(ids.tenant, id, { ...serviceInput(), branchId: null }),
    ).toMatchObject({ kind: 'changed' });
    expect(
      await doctors.hasServiceAssignment(ids.tenant, id, ids.service, ids.facility, ids.branch),
    ).toBe(true);
  });

  it('prevents service grants for deactivated doctors and wrong or inactive locations', async () => {
    const id = await doctorId();
    await scopes.assignFacility({ ...scopeInput(), facilityId: ids.facility });
    expect(
      await doctors.assignService(ids.tenant, id, {
        ...serviceInput(),
        facilityId: ids.otherFacility,
      }),
    ).toEqual({ kind: 'target-not-found' });
    await doctors.changeStatusIfCurrent(ids.tenant, id, 'ACTIVE', 'DEACTIVATED', new Date());
    expect(await doctors.assignService(ids.tenant, id, serviceInput())).toEqual({
      kind: 'doctor-deactivated',
    });
    expect(await doctors.assignSpecialty(ids.tenant, id, ids.specialty)).toEqual({
      kind: 'doctor-deactivated',
    });
  });

  it('serializes competing doctor creation with no orphan catalog or service records', async () => {
    const results = await Promise.all([createDoctor(), createDoctor()]);
    expect(results.filter((result) => result.kind === 'created')).toHaveLength(1);
    expect(results.filter((result) => result.kind === 'already-exists')).toHaveLength(1);
    expect(await collection('doctors').countDocuments({})).toBe(1);
  });
});
