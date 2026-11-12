'use strict';

// This runner never uses application connection secrets. It provisions and
// destroys its own MySQL instance and passes only that instance to the tests.
const { randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');
const { cpSync, mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { GenericContainer, Wait } = require('testcontainers');

async function main() {
  if (process.env.DOCKER_HOST !== 'unix:///var/run/docker.sock') {
    throw new Error('Select the local Docker socket explicitly before running this test.');
  }
  const password = randomBytes(24).toString('hex');
  const rootPassword = randomBytes(24).toString('hex');
  const database = `subscription_portal_test_${randomBytes(6).toString('hex')}`;
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'thanarah-portal-mysql-'));
  let container;
  let activeChild;
  let stopping = false;
  const safeEnv = {
    PATH: process.env.PATH || '/usr/bin:/bin',
    HOME: process.env.HOME || '/tmp',
    TMPDIR: tmpdir(),
    NODE_ENV: 'test',
    CI: '1',
    PRISMA_HIDE_UPDATE_MESSAGE: '1',
  };
  const redact = (text) =>
    String(text)
      .replaceAll(password, '[redacted]')
      .replaceAll(rootPassword, '[redacted]')
      .replace(/mysql:\/\/[^@\s]+@/gi, 'mysql://[redacted]@');
  const run = (args, env) =>
    new Promise((resolveRun, rejectRun) => {
      const child = spawn(process.execPath, args, {
        cwd: process.cwd(),
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 180_000,
      });
      activeChild = child;
      // Buffer output so a credential split across stream chunks is still removed.
      let output = '';
      child.stdout.on('data', (chunk) => {
        output += chunk;
      });
      child.stderr.on('data', (chunk) => {
        output += chunk;
      });
      child.once('error', rejectRun);
      child.once('close', (code) => {
        activeChild = undefined;
        process.stdout.write(redact(output));
        if (code === 0) resolveRun();
        else rejectRun(new Error(`Disposable test command failed with exit code ${code}.`));
      });
    });
  const stop = () => {
    stopping = true;
    process.exitCode = 1;
    activeChild?.kill('SIGTERM');
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    console.log('Starting disposable MySQL; application database secrets are not used.');
    container = await new GenericContainer('mysql:8.0.41')
      .withEnvironment({
        MYSQL_ROOT_PASSWORD: rootPassword,
        MYSQL_DATABASE: database,
        MYSQL_USER: 'portal_test',
        MYSQL_PASSWORD: password,
      })
      .withExposedPorts(3306)
      .withWaitStrategy(Wait.forLogMessage(/ready for connections.*port: 3306/i, 1))
      .withStartupTimeout(120_000)
      .start();
    if (stopping) throw new Error('Test run cancelled.');
    const uri = `mysql://portal_test:${password}@${container.getHost()}:${container.getMappedPort(3306)}/${database}`;
    const schema = join(temporaryRoot, 'prisma', 'schema.prisma');
    cpSync(resolve('prisma'), join(temporaryRoot, 'prisma'), { recursive: true });
    await run(
      [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', schema],
      { ...safeEnv, DATABASE_URL: uri },
    );
    if (stopping) throw new Error('Test run cancelled.');
    await run(
      [
        resolve('node_modules/vitest/vitest.mjs'),
        'run',
        'test/subscription-tenant-portal.mysql.integration.spec.ts',
        '--reporter=verbose',
      ],
      {
        ...safeEnv,
        MYSQL_DATABASE_URL: uri,
        RUN_MYSQL_PAYMENT_TESTS: '1',
        CHROMIUM_PATH: process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium',
      },
    );
  } finally {
    activeChild?.kill('SIGTERM');
    if (container) await container.stop();
    rmSync(temporaryRoot, { recursive: true, force: true });
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

main().catch((error) => {
  // Do not print infrastructure errors: their details can contain connection credentials.
  console.error(
    error.message.startsWith('Disposable test command failed')
      ? error.message
      : 'Disposable MySQL test setup or cleanup failed; no application database was used.',
  );
  process.exitCode = 1;
});
