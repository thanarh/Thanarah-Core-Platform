import { randomUUID } from 'node:crypto';
import { type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import multipart from '@fastify/multipart';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthenticatedPlatformUser } from '../src/auth/auth.types';
import { AuthenticationError } from '../src/auth/errors/auth.errors';
import { PlatformAuthGuard } from '../src/auth/guards/platform-auth.guard';
import { APP_CONSTANTS } from '../src/common/constants/app.constants';
import { TenantPermissionDeniedError } from '../src/tenant/tenant-authorization.errors';
import { TenantAuthorizationGuard } from '../src/tenant/tenant-authorization.guard';
import type { TrustedTenantContext } from '../src/tenant/tenant-context.contract';
import { TenantContextGuard } from '../src/tenant/tenant-context.guard';
import { TenantSubscriptionPortalController } from '../src/tenant/tenant-subscription-portal.controller';
import { SubscriptionPaymentService } from '../src/subscriptions/subscription-payment.service';

const enabled = process.env.RUN_MYSQL_PAYMENT_TESTS === '1' &&
  typeof process.env.MYSQL_DATABASE_URL === 'string';
const tenantA = randomUUID();
const tenantB = randomUUID();
const planA = randomUUID();
const planB = randomUUID();
const subscriptionA = randomUUID();
const subscriptionB = randomUUID();
const userId = randomUUID();
const sessionId = randomUUID();
const actor: AuthenticatedPlatformUser = {
  userId,
  sessionId,
  tokenVersion: 1,
  platformRoleIds: [],
};
const tenantPermissions = new Set<string>();
const authorization = {
  authorize: async (_context: TrustedTenantContext, permission: string) => {
    if (!tenantPermissions.has(permission)) throw new TenantPermissionDeniedError();
  },
};

class TestPlatformAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
      authenticatedPlatformUser?: AuthenticatedPlatformUser;
    }>();
    if (request.headers.authorization !== 'Bearer valid') {
      throw new AuthenticationError('AUTH_TOKEN_MISSING', 'Authorization token is required');
    }
    request.authenticatedPlatformUser = actor;
    return true;
  }
}

class TestTenantContextGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      params?: Record<string, string>;
      authenticatedPlatformUser?: AuthenticatedPlatformUser;
      trustedTenantContext?: TrustedTenantContext;
    }>();
    if (request.params?.tenantId !== tenantA || !request.authenticatedPlatformUser) {
      throw new TenantPermissionDeniedError();
    }
    request.trustedTenantContext = {
      tenantId: tenantA,
      membershipId: randomUUID(),
      platformUserId: request.authenticatedPlatformUser.userId,
    } as TrustedTenantContext;
    return true;
  }
}

describe.skipIf(!enabled)('Tenant subscription portal on disposable MySQL', () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.MYSQL_DATABASE_URL } },
  });
  const payments = new SubscriptionPaymentService(prisma as never);
  let app: NestFastifyApplication;

  beforeAll(async () => {
    await prisma.$connect();
    const now = new Date();
    await prisma.tenant.createMany({
      data: [
        { id: tenantA, slug: `portal-a-${tenantA.slice(0, 8)}`, legalName: 'Test Clinic A', displayName: 'Clinic A' },
        { id: tenantB, slug: `portal-b-${tenantB.slice(0, 8)}`, legalName: 'Test Clinic B', displayName: 'Clinic B' },
      ],
    });
    await prisma.plan.createMany({
      data: [
        { id: planA, key: `portal-a-${planA.slice(0, 8)}`, name: 'Synthetic Plan A' },
        { id: planB, key: `portal-b-${planB.slice(0, 8)}`, name: 'Synthetic Plan B' },
      ],
    });
    await prisma.subscription.createMany({
      data: [
        { id: subscriptionA, tenantId: tenantA, planId: planA, startsAt: new Date(now.getTime() - 60_000), endsAt: new Date(now.getTime() + 86_400_000) },
        { id: subscriptionB, tenantId: tenantB, planId: planB, startsAt: new Date(now.getTime() - 60_000), endsAt: new Date(now.getTime() + 86_400_000) },
      ],
    });
    await prisma.subscriptionPaymentSettings.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        enabled: true,
        bankName: 'Synthetic Test Bank',
        accountHolder: 'Thanarah Test Account',
        iban: 'SA0000000000000000000000',
        currencyCode: 'SAR',
        version: 1,
      },
      update: {
        enabled: true,
        bankName: 'Synthetic Test Bank',
        accountHolder: 'Thanarah Test Account',
        iban: 'SA0000000000000000000000',
        currencyCode: 'SAR',
      },
    });

    const module = await Test.createTestingModule({
      controllers: [TenantSubscriptionPortalController],
      providers: [TenantAuthorizationGuard, SubscriptionPaymentService],
    })
      .overrideGuard(PlatformAuthGuard)
      .useClass(TestPlatformAuthGuard)
      .overrideGuard(TenantContextGuard)
      .useClass(TestTenantContextGuard)
      .overrideGuard(TenantAuthorizationGuard)
      .useValue(new TenantAuthorizationGuard(new Reflector(), authorization as never))
      .overrideProvider(SubscriptionPaymentService)
      .useValue(payments)
      .compile();

    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix(APP_CONSTANTS.apiPrefix);
    await app.register(multipart, { limits: { fileSize: 4 * 1024 * 1024, files: 1, fields: 4 } });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    tenantPermissions.clear();
    tenantPermissions.add('tenant.subscriptions.read');
    tenantPermissions.add('tenant.subscriptions.payments.submit');
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await prisma.subscriptionTransfer.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    await prisma.subscription.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
    await prisma.plan.deleteMany({ where: { id: { in: [planA, planB] } } });
    await prisma.subscriptionPaymentSettings.deleteMany({ where: { id: 'default' } });
    await prisma.$disconnect();
  }, 60_000);

  it('serves only the trusted tenant subscription, central instructions, and scoped receipt status', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/tenants/${tenantA}/subscription-portal`,
      headers: { authorization: 'Bearer valid' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      subscription: { id: subscriptionA, planName: 'Synthetic Plan A' },
      bankTransfer: { enabled: true, bankName: 'Synthetic Test Bank', currencyCode: 'SAR' },
      transfers: [],
    });
    expect(JSON.stringify(response.json())).not.toContain('receiptBytes');
  });

  it('rejects unauthenticated and cross-tenant reads before reaching the service', async () => {
    const unauthenticated = await app.inject({
      method: 'GET',
      url: `/api/v1/tenants/${tenantA}/subscription-portal`,
    });
    const crossTenant = await app.inject({
      method: 'GET',
      url: `/api/v1/tenants/${tenantB}/subscription-portal`,
      headers: { authorization: 'Bearer valid' },
    });
    expect(unauthenticated.statusCode).toBe(401);
    expect(crossTenant.statusCode).toBe(403);
    expect(await prisma.subscriptionTransfer.count({ where: { tenantId: tenantB } })).toBe(0);
  });

  it('keeps platform subscription permissions separate from tenant portal access', async () => {
    tenantPermissions.clear();
    tenantPermissions.add('subscriptions.read');
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/tenants/${tenantA}/subscription-portal`,
      headers: { authorization: 'Bearer valid' },
    });
    expect(response.statusCode).toBe(403);
    tenantPermissions.add('tenant.subscriptions.read');
  });

  it('submits a PDF through the tenant API, stores it in MySQL, and exposes rejection reason', async () => {
    const boundary = 'thanarah-test-boundary';
    const pdf = '%PDF-1.4\nSynthetic receipt';
    const payload = [
      `--${boundary}\r\n`,
      'Content-Disposition: form-data; name="receipt"; filename="receipt.pdf"\r\n',
      'Content-Type: application/pdf\r\n\r\n',
      `${pdf}\r\n`,
      `--${boundary}--\r\n`,
    ].join('');
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/tenants/${tenantA}/subscription-portal/transfers`,
      headers: {
        authorization: 'Bearer valid',
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'idempotency-key': 'tenant-portal-integration-1',
      },
      payload,
    });
    expect(response.statusCode).toBe(201);
    const submitted = response.json();
    expect(submitted).toMatchObject({
      tenantId: tenantA,
      subscriptionId: subscriptionA,
      status: 'PENDING_REVIEW',
    });
    expect(submitted).not.toHaveProperty('receiptBytes');
    const stored = await prisma.subscriptionTransfer.findUnique({
      where: { id: submitted.id },
      select: { tenantId: true, subscriptionId: true, receiptBytes: true },
    });
    expect(stored).toMatchObject({
      tenantId: tenantA,
      subscriptionId: subscriptionA,
      receiptBytes: Buffer.from(pdf),
    });
    expect(await prisma.subscriptionTransfer.count({ where: { tenantId: tenantB } })).toBe(0);

    const reviewed = await payments.reviewTransfer(
      submitted.id,
      { expectedVersion: 1, reason: 'Synthetic review rejection' },
      'REJECTED',
      actor,
    );
    expect(reviewed).toMatchObject({
      status: 'REJECTED',
      reviewReason: 'Synthetic review rejection',
    });
    const portal = await app.inject({
      method: 'GET',
      url: `/api/v1/tenants/${tenantA}/subscription-portal`,
      headers: { authorization: 'Bearer valid' },
    });
    expect(portal.json().transfers).toEqual([
      expect.objectContaining({
        id: submitted.id,
        status: 'REJECTED',
        reviewReason: 'Synthetic review rejection',
      }),
    ]);
  });

  it('does not allow tenant submission without tenant submit permission', async () => {
    tenantPermissions.delete('tenant.subscriptions.payments.submit');
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/tenants/${tenantA}/subscription-portal/transfers`,
      headers: { authorization: 'Bearer valid' },
      payload: {},
    });
    expect(response.statusCode).toBe(403);
    expect(await prisma.subscriptionTransfer.count({ where: { tenantId: tenantA } })).toBe(1);
    tenantPermissions.add('tenant.subscriptions.payments.submit');
  });
});
