import { describe, it, expect, beforeAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { AppController } from '../src/app.controller';

describe('AppController', () => {
  let controller: AppController;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AppController],
    }).compile();

    controller = module.get<AppController>(AppController);
  });

  it('returns status ok and a valid timestamp', () => {
    const result = controller.health();

    expect(result.status).toBe('ok');
    expect(typeof result.timestamp).toBe('string');
    expect(() => new Date(result.timestamp)).not.toThrow();
  });
});
