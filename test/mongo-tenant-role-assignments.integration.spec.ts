import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import type { Db, MongoClientOptions } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ConfigService } from '../src/config/config.service';
import {
  OfficialPlatformMongoClientFactory,
  PlatformMongoClientManager,
} from '../src/platform-mongo/platform-mongo.client.manager';
import { provisionPlatformMongoIndexes } from '../src/platform-mongo/platform-mongo.indexes';
import {
  documentTimestamps,
  stableAssignmentId,
  tenantMembershipRoleSchema,
  tenantStaffRoleSchema,
} from '../src/platform-mongo/platform-mongo.models';
import { MongoTenantMembershipRoleRepository } from '../src/platform-mongo/mongo-tenant-membership-role.repository';
import { MongoTenantStaffRoleRepository } from '../src/platform-mongo/mongo-tenant-staff-role.repository';
import { MongoTenantMembershipRepository } from '../src/platform-mongo/mongo-tenant-membership.repository';
import { MongoTenantAuthorizationContext } from '../src/platform-mongo/mongo-tenant-authorization.context';
import { PlatformMongoUnavailableError } from '../src/platform-mongo/platform-mongo.errors';
import { MongoFacilitySchedulingPolicyRepository } from '../src/platform-mongo/mongo-facility-scheduling-policy.repository';
import { schedulingPolicyRulesSchema } from '../src/tenant/appointment-scheduling-policy.dto';
import {
  SchedulingPolicyReferenceInvalidError,
  SchedulingPolicyVersionConflictError,
} from '../src/tenant/appointment-scheduling-policy.errors';

const uri = process.env.PHASE65_PLATFORM_MONGO_URI;
const baseName = process.env.PHASE65_PLATFORM_MONGO_DATABASE;
const integration = uri && baseName ? describe : describe.skip;
const databaseName = `${baseName ?? 'skipped'}_roles`;

integration('Mongo tenant role assignment contracts on a disposable replica set', () => {
  let db: Db;
  let client: MongoClient;
  let manager: PlatformMongoClientManager;
  let memberships: MongoTenantMembershipRoleRepository;
  let staffRoles: MongoTenantStaffRoleRepository;
  let policies: MongoFacilitySchedulingPolicyRepository;
  const authorizationReads: Array<{
    collection: string;
    session: string;
    transaction: string;
    autocommit: unknown;
  }> = [];
  const ids = {
    tenant: randomUUID(),
    otherTenant: randomUUID(),
    actor: randomUUID(),
    target: randomUUID(),
    outsider: randomUUID(),
    actorMembership: randomUUID(),
    targetMembership: randomUUID(),
    outsiderMembership: randomUUID(),
    staff: randomUUID(),
    actorStaff: randomUUID(),
    owner: randomUUID(),
    reader: randomUUID(),
    writer: randomUUID(),
    permission: randomUUID(),
    writerPermission: randomUUID(),
    facility: randomUUID(),
  };
  const assignMembership = (): Parameters<TenantMembershipRoleRepository['assign']>[0] => ({
    tenantId: ids.tenant,
    actorMembershipId: ids.actorMembership,
    actorPlatformUserId: ids.actor,
    targetMembershipId: ids.targetMembership,
    roleId: ids.reader,
  });
  const assignStaff = (): Parameters<TenantStaffRoleRepository['assign']>[0] => ({
    tenantId: ids.tenant,
    actorMembershipId: ids.actorMembership,
    actorPlatformUserId: ids.actor,
    staffId: ids.staff,
    roleId: ids.writer,
  });
  const context = {
    tenantId: ids.tenant,
    membershipId: ids.targetMembership,
    platformUserId: ids.target,
  };
  const policyInput = (): Parameters<MongoFacilitySchedulingPolicyRepository['upsert']>[0] => ({
    tenantId: ids.tenant,
    facilityId: ids.facility,
    actorUserId: ids.actor,
    timeZone: 'Asia/Riyadh',
    rules: schedulingPolicyRulesSchema.parse({ allowedDurationsMinutes: [15, 30] }),
  });

  beforeAll(async () => {
    // Never accept app secrets or arbitrary hosts, even when explicitly enabled.
    if (
      !uri ||
      !baseName ||
      !/^mongodb:\/\/127\.0\.0\.1:45271,127\.0\.0\.1:45272,127\.0\.0\.1:45273\/\?replicaSet=rs0&retryWrites=true$/u.test(
        uri,
      ) ||
      !/^phase65_platform_[a-zA-Z0-9_]+$/u.test(baseName)
    ) {
      throw new Error('Role contracts require the disposable loopback replica-set runner.');
    }
    client = new MongoClient(uri, { serverSelectionTimeoutMS: 5_000 });
    await client.connect();
    db = client.db(databaseName);
    class ObservingFactory extends OfficialPlatformMongoClientFactory {
      override create(value: string, options: MongoClientOptions): MongoClient {
        const connection = new MongoClient(value, { ...options, monitorCommands: true });
        connection.on('commandStarted', (event) => {
          if (event.commandName === 'find' && event.databaseName === databaseName) {
            authorizationReads.push({
              collection: String(event.command.find),
              session: JSON.stringify(event.command.lsid),
              transaction: String(event.command.txnNumber),
              autocommit: event.command.autocommit,
            });
          }
        });
        return connection;
      }
    }
    manager = new PlatformMongoClientManager(
      {
        platformMongoUri: uri,
        platformMongoDatabase: databaseName,
      } as ConfigService,
      new ObservingFactory(),
    );
    memberships = new MongoTenantMembershipRoleRepository(manager);
    staffRoles = new MongoTenantStaffRoleRepository(manager);
    policies = new MongoFacilitySchedulingPolicyRepository(manager);
    await provisionPlatformMongoIndexes(db);
  }, 30_000);

  beforeEach(async () => {
    for (const name of [
      'tenants',
      'platform_users',
      'tenant_memberships',
      'tenant_staff',
      'tenant_roles',
      'tenant_permissions',
      'tenant_role_permissions',
      'tenant_membership_roles',
      'tenant_staff_roles',
      'facilities',
      'facility_scheduling_policies',
      'facility_scheduling_policy_revisions',
    ])
      await db.collection(name).deleteMany({});
    const now = new Date();
    const common = { ...documentTimestamps(now), schemaVersion: 1 };
    const lifecycle = {
      status: 'ACTIVE',
      statusChangedAt: now,
      suspendedAt: null,
      deactivatedAt: null,
    };
    await db.collection<{ _id: string }>('facilities').insertOne({
      _id: ids.facility,
      ...common,
      ...lifecycle,
      tenantId: ids.tenant,
      name: 'Synthetic facility',
    });
    await db.collection('tenants').insertMany(
      [ids.tenant, ids.otherTenant].map((id) => ({
        _id: id as never,
        ...common,
        ...lifecycle,
        slug: `test-${id}`,
        legalName: 'Synthetic',
        displayName: 'Synthetic',
      })),
    );
    for (const [id, membershipId, tenantId] of [
      [ids.actor, ids.actorMembership, ids.tenant],
      [ids.target, ids.targetMembership, ids.tenant],
      [ids.outsider, ids.outsiderMembership, ids.otherTenant],
    ]) {
      await db.collection<{ _id: string }>('platform_users').insertOne({
        _id: id,
        ...common,
        email: `${id}@example.test`,
        fullName: 'Synthetic user',
        passwordHash: 'synthetic-not-a-login-hash',
        status: 'ACTIVE',
        tokenVersion: 0,
        failedLoginAttempts: 0,
        lockedUntil: null,
      });
      await db.collection<{ _id: string }>('tenant_memberships').insertOne({
        _id: membershipId,
        ...common,
        tenantId,
        platformUserId: id,
        status: 'ACTIVE',
        statusChangedAt: now,
        activatedAt: now,
        suspendedAt: null,
        removedAt: null,
      });
    }
    await db.collection<{ _id: string }>('tenant_staff').insertMany([
      {
        _id: ids.staff,
        ...common,
        ...lifecycle,
        tenantId: ids.tenant,
        userId: ids.target,
        membershipId: ids.targetMembership,
        displayName: 'Synthetic target',
        jobTitle: null,
      },
      {
        _id: ids.actorStaff,
        ...common,
        ...lifecycle,
        tenantId: ids.tenant,
        userId: ids.actor,
        membershipId: ids.actorMembership,
        displayName: 'Synthetic actor',
        jobTitle: null,
      },
    ]);
    await db.collection<{ _id: string }>('tenant_roles').insertMany(
      [
        [ids.owner, 'OWNER'],
        [ids.reader, 'READER'],
        [ids.writer, 'WRITER'],
      ].map(([id, code]) => ({
        _id: id,
        ...common,
        tenantId: ids.tenant,
        code,
        name: code,
        description: null,
        isSystemRole: false,
      })),
    );
    await db.collection<{ _id: string }>('tenant_permissions').insertMany([
      { _id: ids.permission, ...common, code: 'patients.read', description: 'Synthetic read' },
      {
        _id: ids.writerPermission,
        ...common,
        code: 'patients.create',
        description: 'Synthetic write',
      },
    ]);
    await db.collection<{ _id: string }>('tenant_role_permissions').insertMany([
      {
        _id: stableAssignmentId(ids.reader, ids.permission),
        tenantRoleId: ids.reader,
        tenantPermissionId: ids.permission,
        assignedAt: now,
      },
      {
        _id: stableAssignmentId(ids.writer, ids.writerPermission),
        tenantRoleId: ids.writer,
        tenantPermissionId: ids.writerPermission,
        assignedAt: now,
      },
    ]);
  });

  afterAll(async () => {
    try {
      if (db) await db.dropDatabase();
    } finally {
      await manager?.onApplicationShutdown();
      await client?.close();
    }
  });

  it('assigns, lists, and removes membership roles with idempotent results', async () => {
    expect(await memberships.assign(assignMembership())).toMatchObject({
      kind: 'changed',
      platformUserId: ids.target,
      roleCode: 'READER',
    });
    expect(await memberships.assign(assignMembership())).toMatchObject({
      kind: 'already-assigned',
    });
    expect(await memberships.listForMembership(ids.tenant, ids.targetMembership)).toMatchObject([
      { role: { id: ids.reader, permissions: [{ permission: { code: 'patients.read' } }] } },
    ]);
    expect(await memberships.resolvePermissionCodes(context)).toEqual(['patients.read']);
    expect(await memberships.hasRoleCode(ids.tenant, ids.targetMembership, 'READER')).toBe(true);
    const removal = {
      tenantId: ids.tenant,
      membershipId: ids.targetMembership,
      roleId: ids.reader,
    };
    expect(await memberships.remove(removal)).toMatchObject({ kind: 'changed' });
    expect(await memberships.remove(removal)).toEqual({ kind: 'not-assigned' });
  });

  it('assigns staff roles and combines membership and staff permissions', async () => {
    await memberships.assign(assignMembership());
    expect(await staffRoles.assign(assignStaff())).toMatchObject({
      kind: 'changed',
      assignment: { staff: { userId: ids.target }, role: { code: 'WRITER' } },
    });
    expect(await staffRoles.assign(assignStaff())).toMatchObject({ kind: 'already-assigned' });
    expect(await staffRoles.listForStaff(ids.tenant, ids.staff)).toHaveLength(1);
    expect(await memberships.resolvePermissionCodes(context)).toEqual([
      'patients.create',
      'patients.read',
    ]);
    expect(await memberships.hasRoleCode(ids.tenant, ids.targetMembership, 'WRITER')).toBe(true);
    expect(await staffRoles.remove(assignStaff())).toMatchObject({ kind: 'changed' });
    expect(await staffRoles.remove(assignStaff())).toEqual({ kind: 'not-assigned' });
  });

  it('rejects cross-tenant references and spoofed actor identities', async () => {
    expect(
      await memberships.assign({
        ...assignMembership(),
        targetMembershipId: ids.outsiderMembership,
      }),
    ).toEqual({ kind: 'not-found' });
    expect(
      await memberships.assign({ ...assignMembership(), actorPlatformUserId: ids.outsider }),
    ).toEqual({ kind: 'not-found' });
    expect(await staffRoles.assign({ ...assignStaff(), tenantId: ids.otherTenant })).toEqual({
      kind: 'not-found',
    });
    expect(await staffRoles.listForStaff(ids.otherTenant, ids.staff)).toBeNull();
    expect(await memberships.listForMembership(ids.otherTenant, ids.targetMembership)).toBeNull();
    expect(
      await memberships.resolvePermissionCodes({ ...context, platformUserId: ids.outsider }),
    ).toEqual([]);
  });

  it('prevents assigning a role to the actor through either path', async () => {
    expect(
      await memberships.assign({ ...assignMembership(), targetMembershipId: ids.actorMembership }),
    ).toEqual({ kind: 'self-assignment' });
    expect(await staffRoles.assign({ ...assignStaff(), staffId: ids.actorStaff })).toEqual({
      kind: 'self-assignment',
    });
  });

  it('requires OWNER for both grant paths and never removes OWNER through ordinary operations', async () => {
    expect(await memberships.assign({ ...assignMembership(), roleId: ids.owner })).toEqual({
      kind: 'owner-only',
    });
    expect(await staffRoles.assign({ ...assignStaff(), roleId: ids.owner })).toEqual({
      kind: 'owner-only',
    });
    await db.collection<{ _id: string }>('tenant_membership_roles').insertOne(
      tenantMembershipRoleSchema.parse({
        _id: stableAssignmentId(ids.actorMembership, ids.owner),
        tenantId: ids.tenant,
        membershipId: ids.actorMembership,
        tenantRoleId: ids.owner,
        assignedAt: new Date(),
      }),
    );
    expect(await memberships.assign({ ...assignMembership(), roleId: ids.owner })).toMatchObject({
      kind: 'changed',
    });
    expect(await staffRoles.assign({ ...assignStaff(), roleId: ids.owner })).toMatchObject({
      kind: 'changed',
    });
    expect(
      await memberships.remove({
        tenantId: ids.tenant,
        membershipId: ids.targetMembership,
        roleId: ids.owner,
      }),
    ).toEqual({ kind: 'owner-protected' });
    expect(await staffRoles.remove({ ...assignStaff(), roleId: ids.owner })).toEqual({
      kind: 'owner-protected',
    });
  });

  it('protects OWNER membership lifecycle even when an ordinary grant was inserted first', async () => {
    await memberships.assign(assignMembership());
    await db.collection<{ _id: string }>('tenant_membership_roles').insertOne(
      tenantMembershipRoleSchema.parse({
        _id: stableAssignmentId(ids.targetMembership, ids.owner),
        tenantId: ids.tenant,
        membershipId: ids.targetMembership,
        tenantRoleId: ids.owner,
        assignedAt: new Date(),
      }),
    );
    expect(
      await new MongoTenantMembershipRepository(manager).changeStatusIfCurrent(
        ids.targetMembership,
        ids.tenant,
        'ACTIVE',
        'SUSPENDED',
        new Date(),
      ),
    ).toEqual({ kind: 'owner-protected' });
  });

  it('accepts an independently held active staff OWNER grant', async () => {
    await db.collection<{ _id: string }>('tenant_staff_roles').insertOne(
      tenantStaffRoleSchema.parse({
        _id: stableAssignmentId(ids.actorStaff, ids.owner),
        tenantId: ids.tenant,
        staffId: ids.actorStaff,
        tenantRoleId: ids.owner,
        assignedAt: new Date(),
      }),
    );
    expect(await memberships.assign({ ...assignMembership(), roleId: ids.owner })).toMatchObject({
      kind: 'changed',
    });
    expect(await staffRoles.assign({ ...assignStaff(), roleId: ids.owner })).toMatchObject({
      kind: 'changed',
    });
  });

  it('denies permissions and new grants for suspended memberships or staff', async () => {
    await memberships.assign(assignMembership());
    await staffRoles.assign(assignStaff());
    await db
      .collection<{ _id: string }>('tenant_staff')
      .updateOne({ _id: ids.staff }, { $set: { status: 'SUSPENDED' } });
    expect(await memberships.resolvePermissionCodes(context)).toEqual([]);
    expect(await staffRoles.assign(assignStaff())).toEqual({ kind: 'staff-ineligible' });
    await db
      .collection<{ _id: string }>('tenant_memberships')
      .updateOne({ _id: ids.targetMembership }, { $set: { status: 'SUSPENDED' } });
    expect(await memberships.assign(assignMembership())).toEqual({ kind: 'not-found' });
    expect(await memberships.hasRoleCode(ids.tenant, ids.targetMembership, 'READER')).toBe(false);
  });

  it('rejects staff grants when the underlying platform user is inactive', async () => {
    await db
      .collection<{ _id: string }>('platform_users')
      .updateOne({ _id: ids.target }, { $set: { status: 'INACTIVE' } });
    expect(await staffRoles.assign(assignStaff())).toEqual({ kind: 'staff-ineligible' });
  });

  it('protects permissions when a referenced role is missing', async () => {
    await memberships.assign(assignMembership());
    await db.collection<{ _id: string }>('tenant_roles').deleteOne({ _id: ids.reader });
    await expect(memberships.resolvePermissionCodes(context)).rejects.toBeInstanceOf(
      PlatformMongoUnavailableError,
    );
  });

  it('reads the membership, staff, role and permission graph in one snapshot transaction', async () => {
    await memberships.assign(assignMembership());
    await staffRoles.assign(assignStaff());
    authorizationReads.length = 0;
    expect(await memberships.resolvePermissionCodes(context)).toEqual([
      'patients.create',
      'patients.read',
    ]);
    expect(new Set(authorizationReads.map((read) => read.session)).size).toBe(1);
    expect(new Set(authorizationReads.map((read) => read.transaction)).size).toBe(1);
    expect(authorizationReads.every((read) => read.autocommit === false)).toBe(true);
    expect(new Set(authorizationReads.map((read) => read.collection))).toEqual(
      new Set([
        'tenant_memberships',
        'tenants',
        'tenant_staff',
        'tenant_membership_roles',
        'tenant_staff_roles',
        'tenant_roles',
        'tenant_role_permissions',
        'tenant_permissions',
      ]),
    );
  });

  it('fails closed if the staff profile belongs to a different identity', async () => {
    await memberships.assign(assignMembership());
    await db
      .collection<{ _id: string }>('tenant_staff')
      .updateOne({ _id: ids.staff }, { $set: { userId: ids.outsider } });
    await expect(memberships.resolvePermissionCodes(context)).rejects.toBeInstanceOf(
      PlatformMongoUnavailableError,
    );
  });

  it('serializes competing membership and staff role grants without duplicates', async () => {
    const memberResults = await Promise.all(
      Array.from({ length: 4 }, () => memberships.assign(assignMembership())),
    );
    expect(memberResults.filter((result) => result.kind === 'changed')).toHaveLength(1);
    expect(memberResults.filter((result) => result.kind === 'already-assigned')).toHaveLength(3);
    const staffResults = await Promise.all(
      Array.from({ length: 4 }, () => staffRoles.assign(assignStaff())),
    );
    expect(staffResults.filter((result) => result.kind === 'changed')).toHaveLength(1);
    expect(
      await db
        .collection('tenant_membership_roles')
        .countDocuments({ membershipId: ids.targetMembership }),
    ).toBe(1);
    expect(await db.collection('tenant_staff_roles').countDocuments({ staffId: ids.staff })).toBe(
      1,
    );
  });

  it('retries a stale snapshot against the actual parent document rather than an adapter-only lock', async () => {
    let attempts = 0;
    const active = await MongoTenantAuthorizationContext.run(manager, async (tx) => {
      attempts += 1;
      await tx.activeTenant(ids.tenant); // establish the snapshot before the external writer
      if (attempts === 1)
        await db
          .collection<{ _id: string }>('tenants')
          .updateOne({ _id: ids.tenant }, { $set: { status: 'SUSPENDED' } });
      return tx.activeTenant(ids.tenant, true);
    });
    expect(active).toBe(false);
    expect(attempts).toBeGreaterThan(1);
    expect(await memberships.assign(assignMembership())).toEqual({ kind: 'not-found' });
    expect(await staffRoles.assign(assignStaff())).toEqual({ kind: 'not-found' });
  });

  it('creates an inactive scheduling policy and atomically records its first revision', async () => {
    const result = await policies.upsert(policyInput());
    expect(result).toMatchObject({
      changed: true,
      policy: { version: 1, status: 'INACTIVE', timeZone: 'Asia/Riyadh' },
    });
    expect(await policies.findActiveByFacility(ids.tenant, ids.facility)).toBeNull();
    const history = await policies.listRevisions(ids.tenant, ids.facility, 10, 0);
    expect(history.total).toBe(1);
    expect(history.items[0]).toMatchObject({
      policyId: result.policy.id,
      version: 1,
      action: 'CREATED',
      actorUserId: ids.actor,
    });
    expect(await policies.findByFacility(ids.otherTenant, ids.facility)).toBeNull();
    expect(await policies.listRevisions(ids.otherTenant, ids.facility, 10, 0)).toEqual({
      items: [],
      total: 0,
    });
  });

  it('keeps scheduling versions, status transitions, time zones and revision ordering consistent', async () => {
    await policies.upsert(policyInput());
    const updated = await policies.upsert({
      ...policyInput(),
      expectedVersion: 1,
      timeZone: 'Asia/Dubai',
    });
    expect(updated.policy).toMatchObject({ version: 2, timeZone: 'Asia/Dubai' });
    const active = await policies.setStatus({
      ...policyInput(),
      expectedVersion: 2,
      status: 'ACTIVE',
    });
    expect(active).toMatchObject({ changed: true, policy: { status: 'ACTIVE', version: 3 } });
    expect(await policies.findActiveTimeZonesByFacilities(ids.tenant, [ids.facility])).toEqual([
      { facilityId: ids.facility, timeZone: 'Asia/Dubai' },
    ]);
    expect(await policies.findActiveTimeZonesByFacilities(ids.otherTenant, [ids.facility])).toEqual(
      [],
    );
    const unchanged = await policies.setStatus({
      ...policyInput(),
      expectedVersion: 3,
      status: 'ACTIVE',
    });
    expect(unchanged).toMatchObject({ changed: false, policy: { version: 3 } });
    const history = await policies.listRevisions(ids.tenant, ids.facility, 2, 1);
    expect(history.total).toBe(3);
    expect(history.items.map((item) => item.action)).toEqual(['UPDATED', 'CREATED']);
  });

  it('rejects stale scheduling mutations without adding revisions', async () => {
    await policies.upsert(policyInput());
    await expect(policies.upsert(policyInput())).rejects.toBeInstanceOf(
      SchedulingPolicyVersionConflictError,
    );
    await expect(
      policies.setStatus({ ...policyInput(), expectedVersion: 0, status: 'ACTIVE' }),
    ).rejects.toBeInstanceOf(SchedulingPolicyVersionConflictError);
    expect((await policies.listRevisions(ids.tenant, ids.facility, 10, 0)).total).toBe(1);
    expect(
      await policies.setStatus({
        ...policyInput(),
        facilityId: randomUUID(),
        expectedVersion: 1,
        status: 'ACTIVE',
      }),
    ).toEqual({ policy: null, changed: false });
  });

  it('permits only one concurrent scheduling revision at the same expected version', async () => {
    await policies.upsert(policyInput());
    const results = await Promise.allSettled([
      policies.upsert({ ...policyInput(), expectedVersion: 1, timeZone: 'Asia/Dubai' }),
      policies.upsert({ ...policyInput(), expectedVersion: 1, timeZone: 'Asia/Riyadh' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(
      SchedulingPolicyVersionConflictError,
    );
    const history = await policies.listRevisions(ids.tenant, ids.facility, 10, 0);
    expect(history.items.map((item) => item.version)).toEqual([2, 1]);
  });

  it('rejects cross-tenant or inactive scheduling references', async () => {
    await expect(
      policies.upsert({ ...policyInput(), tenantId: ids.otherTenant }),
    ).rejects.toBeInstanceOf(SchedulingPolicyReferenceInvalidError);
    await db
      .collection<{ _id: string }>('facilities')
      .updateOne({ _id: ids.facility }, { $set: { status: 'SUSPENDED' } });
    await expect(policies.upsert(policyInput())).rejects.toBeInstanceOf(
      SchedulingPolicyReferenceInvalidError,
    );
    expect(await db.collection('facility_scheduling_policies').countDocuments({})).toBe(0);
  });

  it('rolls back a scheduling write when its revision cannot be inserted', async () => {
    const first = await policies.upsert(policyInput());
    const collection = db.collection<{ _id: string }>('facility_scheduling_policy_revisions');
    const existing = await collection.findOne({ policyId: first.policy.id, version: 1 });
    if (!existing) throw new Error('Expected the first synthetic revision');
    // A deliberately conflicting future version exercises the real transaction
    // abort path without leaving a server failpoint active.
    await collection.insertOne({ ...existing, _id: randomUUID(), version: 2 });
    await expect(
      policies.upsert({ ...policyInput(), expectedVersion: 1, timeZone: 'Asia/Dubai' }),
    ).rejects.toBeInstanceOf(PlatformMongoUnavailableError);
    expect(await policies.findByFacility(ids.tenant, ids.facility)).toMatchObject({
      version: 1,
      timeZone: 'Asia/Riyadh',
    });
  });
});
