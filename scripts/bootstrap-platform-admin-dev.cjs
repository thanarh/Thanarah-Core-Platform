const { PrismaClient } = require('@prisma/client');
const argon2 = require('argon2');
const { resolveCentralDatabaseUrl } = require('../dist/config/database-url-policy');

const EMAIL = 'admin@thanarah.com';
const FULL_NAME = 'Platform Administrator';
const ROLE_CODE = 'SUPER_ADMIN';

async function main() {
  if (process.env.NODE_ENV !== 'development') {
    throw new Error('Blocked: NODE_ENV must be exactly development.');
  }
  if (!process.env.MYSQL_DATABASE_URL) {
    throw new Error('Blocked: MYSQL_DATABASE_URL is not configured.');
  }
  if (!process.env.BOOTSTRAP_PASSWORD || process.env.BOOTSTRAP_PASSWORD.length < 14) {
    throw new Error('Blocked: a password of at least 14 characters is required.');
  }

  const database = resolveCentralDatabaseUrl({
    nodeEnv: process.env.NODE_ENV,
    databaseUrl: process.env.DATABASE_URL || '',
    developmentMysqlUrl: process.env.MYSQL_DATABASE_URL,
  });
  if (database.status !== 'ready') {
    throw new Error(`Blocked: development database configuration is ${database.status}.`);
  }

  const prisma = new PrismaClient({
    datasources: { db: { url: database.url } },
  });
  try {
    try {
      await prisma.$connect();
    } catch {
      throw new Error(
        'Could not connect to the configured development database. Check its configuration and migrations.',
      );
    }
    const [existingUser, role, permissionCount] = await Promise.all([
      prisma.user.findUnique({ where: { email: EMAIL }, select: { id: true } }),
      prisma.platformRole.findUnique({
        where: { code: ROLE_CODE },
        select: { id: true, permissions: { select: { permissionId: true } } },
      }),
      prisma.platformPermission.count(),
    ]);

    if (existingUser) {
      throw new Error(`Blocked: ${EMAIL} already exists; no account changes were made.`);
    }
    if (!role || permissionCount === 0 || role.permissions.length !== permissionCount) {
      throw new Error(
        `Blocked: ${ROLE_CODE} does not have every platform permission. Apply the existing development migrations first; this command does not run migrations.`,
      );
    }

    const passwordHash = await argon2.hash(process.env.BOOTSTRAP_PASSWORD, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
      hashLength: 32,
    });

    await prisma.user.create({
      data: {
        email: EMAIL,
        fullName: FULL_NAME,
        passwordHash,
        platformRoles: { create: { role: { connect: { id: role.id } } } },
      },
    });

    console.log(`Created ${EMAIL} with ${ROLE_CODE} on the verified development database.`);
  } finally {
    process.env.BOOTSTRAP_PASSWORD = '';
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  process.env.BOOTSTRAP_PASSWORD = '';
  console.error(error instanceof Error ? error.message : 'Development bootstrap failed.');
  process.exitCode = 1;
});
