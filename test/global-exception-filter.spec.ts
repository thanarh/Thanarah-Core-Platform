import { Controller, Get, Logger } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';

@Controller('failure-test')
class FailureTestController {
  @Get('database')
  databaseFailure(): never {
    const error = new Error(
      'connection failed mysql://user:password@db.internal/clinical; SELECT * FROM patients',
    ) as Error & { code: string };
    error.code = 'P1001';
    throw error;
  }

  @Get('unexpected')
  unexpectedFailure(): never {
    throw new Error('sensitive stack detail');
  }
}

describe('GlobalExceptionFilter failure reporting', () => {
  let app: NestFastifyApplication | undefined;

  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
    vi.restoreAllMocks();
  });

  it('returns a sanitized 503 for a transient central database failure', async () => {
    const module = await Test.createTestingModule({
      controllers: [FailureTestController],
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();

    const response = await app.inject({ method: 'GET', url: '/failure-test/database' });
    const body = response.json();

    expect(response.statusCode).toBe(503);
    expect(body).toMatchObject({
      success: false,
      error: {
        code: 'DATABASE_UNAVAILABLE',
        message: 'A required database service is unavailable',
      },
    });
    expect(JSON.stringify(body)).not.toMatch(/mysql:|password|SELECT|clinical/u);
  });

  it('does not write raw unexpected error messages or stacks to application logs', async () => {
    const errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const module = await Test.createTestingModule({
      controllers: [FailureTestController],
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();

    const response = await app.inject({ method: 'GET', url: '/failure-test/unexpected' });

    expect(response.statusCode).toBe(500);
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('sensitive stack detail');
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('stack');
  });
});
