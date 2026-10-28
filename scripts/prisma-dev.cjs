const { spawnSync } = require('node:child_process');
const {
  getSafeDatabaseUrlDiagnostics,
  resolveCentralDatabaseUrl,
} = require('../dist/config/database-url-policy');

function main() {
  const diagnostics = getSafeDatabaseUrlDiagnostics(
    process.env.MYSQL_DATABASE_URL,
    'MYSQL_DATABASE_URL',
    Object.prototype.hasOwnProperty.call(process.env, 'MYSQL_DATABASE_URL'),
  );
  const database = resolveCentralDatabaseUrl({
    nodeEnv: process.env.NODE_ENV || '',
    databaseUrl: process.env.DATABASE_URL || '',
    developmentMysqlUrl: process.env.MYSQL_DATABASE_URL || '',
  });

  if (process.argv.includes('--check-config')) {
    console.log(JSON.stringify({ ...diagnostics, resolutionStatus: database.status }));
    return;
  }

  if (process.env.NODE_ENV !== 'development') {
    console.error('Blocked: Prisma development commands require NODE_ENV=development.');
    process.exitCode = 1;
    return;
  }

  if (database.status !== 'ready') {
    console.error(`Blocked: development database configuration is ${database.status}.`);
    process.exitCode = 1;
    return;
  }

  const prisma = spawnSync('./node_modules/.bin/prisma', process.argv.slice(2), {
    env: { ...process.env, DATABASE_URL: database.url },
    stdio: 'inherit',
  });

  if (prisma.error) {
    console.error('Could not start the local Prisma CLI.');
    process.exitCode = 1;
  } else {
    process.exitCode = prisma.status ?? 1;
  }
}

main();
