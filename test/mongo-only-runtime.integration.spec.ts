import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, it, expect } from 'vitest';
const uri = process.env.PHASE65_PLATFORM_MONGO_URI;
const base = process.env.PHASE65_PLATFORM_MONGO_DATABASE;
const integration = uri && base ? describe : describe.skip;
integration('compiled MongoDB-only application', () => {
  it('runs authenticated API workflows, restart and refresh-outage recovery without SQL', async () => {
    if (
      !uri ||
      !base ||
      !/^mongodb:\/\/127\.0\.0\.1:45271,127\.0\.0\.1:45272,127\.0\.0\.1:45273\/\?replicaSet=rs0&retryWrites=true$/u.test(
        uri,
      ) ||
      !/^phase65_platform_[a-zA-Z0-9_]+$/u.test(base)
    )
      throw new Error('Only the disposable replica set is allowed');
    const result = await promisify(execFile)(
      process.execPath,
      ['scripts/verify-mongo-runtime.cjs'],
      {
        timeout: 150_000,
        maxBuffer: 2_000_000,
        env: {
          PATH: process.env.PATH,
          NODE_ENV: 'development',
          PLATFORM_MONGO_URI: uri,
          PLATFORM_MONGO_DATABASE: `${base}_runtime`,
          TENANT_STORAGE_PROVIDER: 'mongodb',
          JWT_ACCESS_SECRET: 'synthetic-runtime-only-secret-not-used-anywhere-else',
          THROTTLE_LIMIT: '1000',
        },
      },
    );
    expect(result.stdout).toContain('MONGO_ONLY_RUNTIME_PASSED');
  }, 165_000);
});
