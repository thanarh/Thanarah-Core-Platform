const { MongoClient } = require('mongodb');
const { migrateTenantRoleDefaults } = require('../dist/platform-mongo/tenant-role-defaults.migration');
const {
  DEFAULT_TENANT_ROLES,
  TENANT_PERMISSION_DEFINITIONS,
} = require('../dist/tenant/tenant-authorization.constants');
const { initializeMongoReferenceData } = require('../dist/platform-mongo/platform-mongo.initialize');

const confirmationFlag = '--apply-tenant-role-defaults-v2';
let completedTenantTransactions = 0;
let changedTenants = 0;
let createdRoles = 0;
let updatedRoles = 0;
let updatedPermissionSets = 0;

async function main() {
  const databaseName = process.env.PLATFORM_MONGO_DATABASE || '';
  const configured = Boolean(process.env.PLATFORM_MONGO_URI && databaseName);
  const safeDatabase =
    /(?:^|[_-])(?:dev|test)(?:[_-]|$)/iu.test(databaseName) &&
    /^[A-Za-z0-9_-]{1,63}$/u.test(databaseName);

  if (process.env.NODE_ENV !== 'development' || !configured || !safeDatabase) {
    throw new Error('Blocked: this migration accepts only an explicitly configured development/test database.');
  }
  if (!process.argv.includes(confirmationFlag)) {
    throw new Error(`Blocked: rerun with ${confirmationFlag} after reviewing the permission changes.`);
  }

  const client = new MongoClient(process.env.PLATFORM_MONGO_URI, {
    appName: 'thanarah-tenant-role-defaults-migration',
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
    monitorCommands: false,
  });

  try {
    await client.connect();
    const db = client.db(databaseName);
    const tenants = await db.collection('tenants').find({}, { projection: { _id: 1 } }).toArray();
    const tenantIds = tenants.map(({ _id }) => _id);
    const roleCodes = DEFAULT_TENANT_ROLES.map(({ code }) => code);
    const permissionCodes = TENANT_PERMISSION_DEFINITIONS.map(({ code }) => code);
    const conflictingRoles = tenantIds.length
      ? await db
          .collection('tenant_roles')
          .find(
            {
              tenantId: { $in: tenantIds },
              code: { $in: roleCodes },
              isSystemRole: false,
            },
            { projection: { _id: 1 } },
          )
          .toArray()
      : [];
    if (conflictingRoles.length) {
      throw new Error('Blocked: one or more custom roles use codes reserved by the new defaults.');
    }

    const referenceSession = client.startSession();
    try {
      await referenceSession.withTransaction(
        () => initializeMongoReferenceData(db, referenceSession),
        {
          readConcern: { level: 'snapshot' },
          writeConcern: { w: 'majority' },
          readPreference: 'primary',
        },
      );
    } finally {
      await referenceSession.endSession();
    }

    const permissions = await db
      .collection('tenant_permissions')
      .find({ code: { $in: permissionCodes } }, { projection: { _id: 1 } })
      .toArray();
    if (permissions.length !== permissionCodes.length) {
      throw new Error('Blocked: reference initialization did not complete the tenant permission catalog.');
    }

    for (const tenant of tenants) {
      const session = client.startSession();
      try {
        const result = await session.withTransaction(
          () => migrateTenantRoleDefaults(db, session, tenant._id),
          {
            readConcern: { level: 'snapshot' },
            writeConcern: { w: 'majority' },
            readPreference: 'primary',
          },
        );
        if (
          result.createdRoleCodes.length ||
          result.updatedRoleCodes.length ||
          result.updatedPermissionRoleCodes.length
        ) {
          changedTenants += 1;
        }
        createdRoles += result.createdRoleCodes.length;
        updatedRoles += result.updatedRoleCodes.length;
        updatedPermissionSets += result.updatedPermissionRoleCodes.length;
        completedTenantTransactions += 1;
      } finally {
        await session.endSession();
      }
    }

    console.log(
      JSON.stringify({
        migration: 'tenant-role-defaults-v2',
        tenantsScanned: tenants.length,
        tenantsChanged: changedTenants,
        rolesCreated: createdRoles,
        roleNamesUpdated: updatedRoles,
        permissionSetsUpdated: updatedPermissionSets,
      }),
    );
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  const safeMessage =
    error instanceof Error && error.message.startsWith('Blocked:')
      ? error.message
      : 'Database operation failed; connection details were hidden.';
  console.error(
    JSON.stringify({
      error: safeMessage,
      tenantTransactionsCompleted: completedTenantTransactions,
      tenantsChanged: changedTenants,
      rolesCreated: createdRoles,
      roleNamesUpdated: updatedRoles,
      permissionSetsUpdated: updatedPermissionSets,
      rerunSafe: true,
    }),
  );
  process.exitCode = 1;
});
