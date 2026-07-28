import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { AppController } from '../src/app.controller';

describe('AppController — health', () => {
  let module: TestingModule;
  let controller: AppController;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      controllers: [AppController],
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
});
