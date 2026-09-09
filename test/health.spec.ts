import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { AppController } from '../src/app.controller';
import { PrismaService } from '../src/database/prisma.service';

describe('AppController — health', () => {
  let module: TestingModule;
  let controller: AppController;
  const prisma = { isReady: vi.fn() };

  beforeAll(async () => {
    module = await Test.createTestingModule({
      controllers: [AppController],
      providers: [{ provide: PrismaService, useValue: prisma }],
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

  it('returns readiness only when the central database is available', async () => {
    prisma.isReady.mockResolvedValueOnce(true);

    await expect(controller.ready()).resolves.toMatchObject({
      status: 'ready',
      database: 'available',
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
});
