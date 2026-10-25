import { ServiceUnavailableException } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppController } from '../src/app.controller';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import type { ConfigService } from '../src/config/config.service';
import { validateEnv } from '../src/config/env.schema';
import { PrismaService } from '../src/database/prisma.service';
import { TenantStorageReadinessService } from '../src/tenant/tenant-storage-readiness.service';

const productionEnvironment = {
  NODE_ENV: 'production',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
  AUTH_REFRESH_COOKIE_SECURE: 'true',
};

function config(overrides: Partial<ConfigService> = {}): ConfigService {
  return {
    databaseUrl: '',
    isProduction: false,
    ...overrides,
  } as ConfigService;
}

describe('application dependency readiness', () => {
  let app: NestFastifyApplication | undefined;

  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
    vi.restoreAllMocks();
  });

  it('allows development configuration without DATABASE_URL', () => {
    expect(validateEnv({ NODE_ENV: 'development', DATABASE_URL: '' }).DATABASE_URL).toBe('');
  });

  it('rejects production configuration without DATABASE_URL', () => {
    expect(() => validateEnv(productionEnvironment)).toThrow(
      'DATABASE_URL is required in production',
    );
  });

  it('rejects disabled or in-memory tenant storage in production', () => {
    expect(() =>
      validateEnv({
        ...productionEnvironment,
        DATABASE_URL: 'mysql://configured-non-production-database',
        TENANT_STORAGE_PROVIDER: 'disabled',
      }),
    ).toThrow('Persistent tenant storage is required in production');
    expect(() =>
      validateEnv({
        ...productionEnvironment,
        DATABASE_URL: 'mysql://configured-non-production-database',
        TENANT_STORAGE_PROVIDER: 'memory',
      }),
    ).toThrow('Persistent tenant storage is required in production');
  });

  it('rejects production MongoDB storage without its connection configuration', () => {
    expect(() =>
      validateEnv({
        ...productionEnvironment,
        DATABASE_URL: 'mysql://configured-non-production-database',
        TENANT_STORAGE_PROVIDER: 'mongodb',
      }),
    ).toThrow('TENANT_STORAGE_MONGO_URI is required in production');
  });

  it('requires validated TLS for production MongoDB storage', () => {
    const productionMongo = {
      ...productionEnvironment,
      DATABASE_URL: 'mysql://configured-non-production-database',
      TENANT_STORAGE_PROVIDER: 'mongodb',
    };

    for (const uri of [
      'mongodb://storage-user:storage-password@db.example.test/thanarah',
      'mongodb://storage-user:storage-password@db.example.test/thanarah?tls=false',
      'mongodb://storage-user:storage-password@db.example.test/thanarah?tls=true&tlsAllowInvalidCertificates=true',
      'mongodb://storage-user:storage-password@db.example.test/thanarah?tls=true&tlsAllowInvalidHostnames=true',
      'mongodb://storage-user:storage-password@db.example.test/thanarah?tlsInsecure=true',
      'mongodb://storage-user:storage-password@db.example.test/thanarah?ssl=true&tls=false',
      'mongodb+srv://storage-user:storage-password@cluster.example.test/thanarah?tls=false',
    ]) {
      expect(() => validateEnv({ ...productionMongo, TENANT_STORAGE_MONGO_URI: uri })).toThrow(
        'Production MongoDB connections must use TLS with certificate and hostname validation',
      );
    }

    expect(
      validateEnv({
        ...productionMongo,
        TENANT_STORAGE_MONGO_URI:
          'mongodb://storage-user:storage-password@db.example.test/thanarah?tls=true',
      }).TENANT_STORAGE_MONGO_URI,
    ).toContain('tls=true');
    expect(
      validateEnv({
        ...productionMongo,
        TENANT_STORAGE_MONGO_URI:
          'mongodb://storage-user:storage-password@db.example.test/thanarah?ssl=true',
      }).TENANT_STORAGE_MONGO_URI,
    ).toContain('ssl=true');
    expect(
      validateEnv({
        ...productionMongo,
        TENANT_STORAGE_MONGO_URI:
          'mongodb+srv://storage-user:storage-password@cluster.example.test/thanarah',
      }).TENANT_STORAGE_MONGO_URI,
    ).toContain('mongodb+srv://');
  });

  it('allows development startup without attempting a database connection', async () => {
    const prisma = new PrismaService(config());
    const connect = vi.spyOn(prisma, '$connect');

    await expect(prisma.onModuleInit()).resolves.toBeUndefined();

    expect(connect).not.toHaveBeenCalled();
    expect(prisma.isConnected()).toBe(false);
    expect(await prisma.isReady()).toBe(false);
  });

  it('fails production startup with a sanitized error when connection fails', async () => {
    const prisma = new PrismaService(
      config({
        databaseUrl: 'mysql://database-user:database-password@127.0.0.1:3306/thanarah',
        isProduction: true,
      }),
    );
    vi.spyOn(prisma, '$connect').mockRejectedValueOnce(
      new Error('cannot connect mysql://database-user:database-password@127.0.0.1:3306/thanarah'),
    );

    await expect(prisma.onModuleInit()).rejects.toThrow('Central database connection failed');
  });

  it('reports ready only after a successful lightweight query', async () => {
    const prisma = new PrismaService(
      config({ databaseUrl: 'mysql://configured-non-production-database' }),
    );
    vi.spyOn(prisma, '$connect').mockResolvedValueOnce();
    const query = vi.spyOn(prisma, '$queryRaw').mockResolvedValueOnce([{ '1': 1 }]);

    await prisma.onModuleInit();

    expect(await prisma.isReady()).toBe(true);
    expect(query).toHaveBeenCalledOnce();
  });

  it('retries readiness after a transient database failure', async () => {
    const prisma = new PrismaService(
      config({ databaseUrl: 'mysql://configured-non-production-database' }),
    );
    const query = vi
      .spyOn(prisma, '$queryRaw')
      .mockRejectedValueOnce(new Error('temporary connection failure'))
      .mockResolvedValueOnce([{ '1': 1 }]);

    expect(await prisma.isReady()).toBe(false);
    expect(await prisma.isReady()).toBe(true);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('returns a safe 503 response without exposing database errors or credentials', async () => {
    const prisma = {
      isReady: vi.fn().mockResolvedValue(false),
    };
    const module = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        {
          provide: TenantStorageReadinessService,
          useValue: { checkReadiness: vi.fn().mockResolvedValue(true) },
        },
      ],
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.setGlobalPrefix('api', { exclude: ['health', 'ready'] });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const response = await app.inject({ method: 'GET', url: '/ready' });
    const liveness = await app.inject({ method: 'GET', url: '/health' });
    const incorrectlyPrefixed = await app.inject({ method: 'GET', url: '/api/ready' });
    const body = response.json();
    const serialized = JSON.stringify(body);

    expect(response.statusCode).toBe(503);
    expect(body).toMatchObject({
      success: false,
      error: {
        code: 'DATABASE_UNAVAILABLE',
        message: 'Central database is unavailable',
      },
    });
    expect(serialized).not.toContain('DATABASE_URL');
    expect(serialized).not.toContain('database-user');
    expect(serialized).not.toContain('database-password');
    expect(serialized).not.toContain('mysql://');
    expect(serialized).not.toContain('Prisma');
    expect(liveness.statusCode).toBe(200);
    expect(incorrectlyPrefixed.statusCode).toBe(404);
  });

  it('returns a sanitized 503 when tenant storage is unavailable and keeps liveness healthy', async () => {
    const prisma = {
      isReady: vi.fn().mockResolvedValue(true),
    };
    const tenantStorage = {
      checkReadiness: vi.fn().mockResolvedValue(false),
    };
    const module = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: TenantStorageReadinessService, useValue: tenantStorage },
      ],
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.setGlobalPrefix('api', { exclude: ['health', 'ready'] });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const response = await app.inject({ method: 'GET', url: '/ready' });
    const liveness = await app.inject({ method: 'GET', url: '/health' });
    const body = response.json();
    const serialized = JSON.stringify(body);

    expect(prisma.isReady).toHaveBeenCalledOnce();
    expect(tenantStorage.checkReadiness).toHaveBeenCalledOnce();
    expect(response.statusCode).toBe(503);
    expect(body).toMatchObject({
      success: false,
      error: {
        code: 'TENANT_STORAGE_UNAVAILABLE',
        message: 'Required tenant storage is unavailable',
      },
    });
    expect(serialized).not.toContain('mongodb://');
    expect(serialized).not.toContain('password');
    expect(liveness.statusCode).toBe(200);
  });

  it('keeps liveness independent of readiness', async () => {
    const controller = new AppController(
      {
        isReady: vi.fn().mockResolvedValue(false),
      } as unknown as PrismaService,
      {
        checkReadiness: vi.fn().mockResolvedValue(false),
      } as unknown as TenantStorageReadinessService,
    );

    expect(controller.health().status).toBe('ok');
    await expect(controller.ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
