import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '../src/config/config.service';
import {
  TenantStorageReadinessService,
  type TenantStorageHealthProvider,
} from '../src/tenant/tenant-storage-readiness.service';

function createService(
  isProduction: boolean,
  checkReadiness: () => Promise<boolean>,
): TenantStorageReadinessService {
  const config = { isProduction } as ConfigService;
  const provider: TenantStorageHealthProvider = { checkReadiness };
  return new TenantStorageReadinessService(config, provider);
}

describe('TenantStorageReadinessService', () => {
  it('fails closed when the configured adapter reports unavailable', async () => {
    const service = createService(false, async () => false);
    await expect(service.checkReadiness()).resolves.toBe(false);
  });

  it('converts adapter exceptions to unavailable without exposing details', async () => {
    const service = createService(false, async () => {
      throw new Error('mongodb://user:secret@internal.example/private');
    });
    await expect(service.checkReadiness()).resolves.toBe(false);
  });

  it('does not fail development startup for unavailable tenant storage', async () => {
    const service = createService(false, async () => false);
    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
  });

  it('fails production startup with a sanitized error when the adapter is unavailable', async () => {
    const service = createService(true, async () => false);
    await expect(service.onApplicationBootstrap()).rejects.toThrow(
      'Required tenant storage is unavailable',
    );
  });

  it('allows production startup when the adapter establishes readiness', async () => {
    const checkReadiness = vi.fn().mockResolvedValue(true);
    const service = createService(true, checkReadiness);
    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(checkReadiness).toHaveBeenCalledOnce();
  });
});
