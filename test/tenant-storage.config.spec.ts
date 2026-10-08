import { describe, expect, it } from 'vitest';
import { validateEnv } from '../src/config/env.schema';
import { effectiveTenantStorageProvider } from '../src/tenant/tenant-storage.mode';

describe('tenant storage configuration', () => {
  it('defaults to disabled instead of silently selecting volatile storage', () => {
    const config = validateEnv({});

    expect(config.TENANT_STORAGE_PROVIDER).toBe('disabled');
    expect(config.TENANT_STORAGE_MONGO_URI).toBe('');
    expect(
      effectiveTenantStorageProvider(
        config.TENANT_STORAGE_PROVIDER,
        config.NODE_ENV === 'development',
      ),
    ).toBe('disabled');
  });

  it('selects process-local memory only when explicitly enabled in development', () => {
    expect(effectiveTenantStorageProvider('memory', true)).toBe('memory');
    expect(effectiveTenantStorageProvider('memory', false)).toBe('disabled');
  });

  it('selects MongoDB explicitly and rejects unknown provider names', () => {
    expect(effectiveTenantStorageProvider('mongodb', false)).toBe('mongodb');
    expect(() => validateEnv({ TENANT_STORAGE_PROVIDER: 'mysql' })).toThrow(
      /TENANT_STORAGE_PROVIDER/u,
    );
  });
});
