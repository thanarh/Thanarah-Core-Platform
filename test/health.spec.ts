import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { AppController } from '../src/app.controller';
import { PrismaService } from '../src/database/prisma.service';
import { TenantStorageReadinessService } from '../src/tenant/tenant-storage-readiness.service';

describe('AppController — health', () => {
  let module: TestingModule;
  let controller: AppController;
  const prisma = { isReady: vi.fn() };
  const tenantStorage = { checkReadiness: vi.fn() };

  beforeAll(async () => {
    module = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: TenantStorageReadinessService, useValue: tenantStorage },
      ],
    }).compile();

    controller = module.get<AppController>(AppController);
  });

  afterAll(async () => {
    await module.close();
  });

  it('returns status ok', () => {
    const result = controller.health();
    expect(result.status).toBe('ok');
  });

  it('returns a valid ISO timestamp', () => {
    const result = controller.health();
    const parsed = new Date(result.timestamp);
    expect(Number.isNaN(parsed.getTime())).toBe(false);
  });

  it('returns readiness only when central and tenant storage are available', async () => {
    prisma.isReady.mockResolvedValueOnce(true);
    tenantStorage.checkReadiness.mockResolvedValueOnce(true);

    await expect(controller.ready()).resolves.toMatchObject({
      status: 'ready',
      database: 'available',
      tenantStorage: 'available',
    });
  });

  it('returns a safe service-unavailable error when the central database is unavailable', async () => {
    prisma.isReady.mockResolvedValueOnce(false);

    await expect(controller.ready()).rejects.toMatchObject({
      status: 503,
      response: {
        code: 'DATABASE_UNAVAILABLE',
        message: 'Central database is unavailable',
      },
    });
  });

  it('returns a safe service-unavailable error when tenant storage is unavailable', async () => {
    prisma.isReady.mockResolvedValueOnce(true);
    tenantStorage.checkReadiness.mockResolvedValueOnce(false);

    await expect(controller.ready()).rejects.toMatchObject({
      status: 503,
      response: {
        code: 'TENANT_STORAGE_UNAVAILABLE',
        message: 'Required tenant storage is unavailable',
      },
    });
  });
});
