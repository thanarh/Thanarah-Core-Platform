import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { UnauthorizedException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { PlatformAuthGuard } from '../src/auth/guards/platform-auth.guard';
import type { PlatformMongoClientManager } from '../src/platform-mongo/platform-mongo.client.manager';
import type { JourneyStore } from '../src/customer-journey/journey.store';
import {
  JourneyInquiries,
  type inquiryInputSchema,
} from '../src/customer-journey/journey.inquiries';
import {
  JourneyAdminInquiryController,
  JourneyPublicInquiryController,
} from '../src/customer-journey/journey.inquiry.controller';

function syntheticInquiry(): z.input<typeof inquiryInputSchema> {
  return {
    operationId: randomUUID(),
    fullName: 'Synthetic website tester',
    email: 'inquiry@example.test',
    organization: 'Synthetic Clinic',
    phone: '+966500000001',
    topic: 'clinic',
    packageCode: 'Lite',
    message: 'Synthetic inquiry for testing only, no patient information.',
    consent: true,
    website: '',
    locale: 'ar',
  };
}

describe('Public inquiries: validation, idempotency and HTTP boundaries', () => {
  let app: NestFastifyApplication;
  let service: JourneyInquiries;
  const records = new Map<string, unknown>();
  const write = vi.fn(async (filter: { _id: string }, update: { $setOnInsert: unknown }) => {
    if (!records.has(filter._id)) records.set(filter._id, update.$setOnInsert);
    return records.get(filter._id);
  });
  const collection = (): { findOneAndUpdate: typeof write } => ({ findOneAndUpdate: write });
  const getDatabase = vi.fn(async () => ({ collection }));
  const read = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    records.clear();
    getDatabase.mockResolvedValue({ collection: () => ({ findOneAndUpdate: write }) });
    service = new JourneyInquiries(
      { getDatabase } as unknown as PlatformMongoClientManager,
      { company: { read } } as unknown as JourneyStore,
    );
    const module = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot({ throttlers: [{ limit: 100, ttl: 60000 }] })],
      controllers: [JourneyPublicInquiryController, JourneyAdminInquiryController],
      providers: [
        { provide: JourneyInquiries, useValue: service },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
    })
      .overrideGuard(PlatformAuthGuard)
      .useValue({
        canActivate: () => {
          throw new UnauthorizedException();
        },
      })
      .compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  afterEach(async () => {
    await app.close();
  });

  it('persists a validated lead and returns only its receipt after a majority write', async () => {
    const payload = syntheticInquiry();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/customer-public/inquiries',
      payload,
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      reference: `TH-${payload.operationId.toUpperCase()}`,
      receivedAt: expect.any(String),
    });
    expect(write).toHaveBeenCalledWith(
      { _id: payload.operationId },
      { $setOnInsert: expect.objectContaining({ status: 'NEW', createdAt: expect.any(Date) }) },
      expect.objectContaining({ upsert: true, writeConcern: { w: 'majority' } }),
    );
    expect(records.size).toBe(1);
  });
  it('does not duplicate the inquiry when an uncertain request is retried', async () => {
    const payload = syntheticInquiry();
    const first = await service.create(payload);
    expect(await service.create(payload)).toEqual(first);
    expect(records.size).toBe(1);
  });
  it('recovers the original receipt when the database committed before the response failed', async () => {
    const payload = syntheticInquiry();
    write.mockImplementationOnce(async (filter, update) => {
      records.set(filter._id, update.$setOnInsert);
      throw new Error('Synthetic lost database response');
    });
    await expect(service.create(payload)).rejects.toMatchObject({ status: 503 });
    const receipt = await service.create(payload);
    expect(receipt.reference).toBe(`TH-${payload.operationId.toUpperCase()}`);
    expect(records.size).toBe(1);
  });
  it('rejects changing a payload under the same operation reference', async () => {
    const payload = syntheticInquiry();
    await service.create(payload);
    await expect(
      service.create({ ...payload, message: 'A different synthetic message.' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(records.size).toBe(1);
  });
  it.each([
    { consent: false },
    { website: 'https://spam.example.test' },
    { email: 'invalid' },
    { phone: '1234' },
    { message: 'short' },
    { packageCode: 'Enterprise' },
    { fullName: '' },
    { organization: '' },
    { topic: 'payments' },
    { role: 'OWNER' },
    { locale: 'other' },
    { message: 'x'.repeat(3001) },
  ])('rejects invalid input or honeypots before writing: %j', async (change) => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/customer-public/inquiries',
      payload: { ...syntheticInquiry(), ...change },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INQUIRY_INPUT_INVALID');
    expect(write).not.toHaveBeenCalled();
  });
  it('rejects the sixth submission from one IP with a real throttler guard', async () => {
    for (let n = 0; n < 5; n++) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/customer-public/inquiries',
        payload: syntheticInquiry(),
      });
      expect(response.statusCode).toBe(201);
    }
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/customer-public/inquiries',
      payload: syntheticInquiry(),
    });
    expect(response.statusCode).toBe(429);
    expect(records.size).toBe(5);
  });
  it('never exposes inquiry lists publicly or bypasses authentication', async () => {
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/customer-public/inquiries',
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/customer-admin/inquiries',
        })
      ).statusCode,
    ).toBe(401);
    expect(read).not.toHaveBeenCalled();
  });
  it('fails closed with a sanitized error when storage is unavailable', async () => {
    getDatabase.mockRejectedValueOnce(new Error('sensitive internal connection details'));
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/customer-public/inquiries',
      payload: syntheticInquiry(),
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('INQUIRY_STORAGE_UNAVAILABLE');
    expect(response.body).not.toContain('sensitive internal');
  });
  it('requires the existing company-wide management permission to read leads', async () => {
    read.mockRejectedValueOnce(new Error('denied'));
    await expect(service.list('synthetic-staff')).rejects.toThrow('denied');
    expect(read).toHaveBeenCalledWith(
      'synthetic-staff',
      'customers.manage_all',
      expect.any(Function),
    );
  });
});
