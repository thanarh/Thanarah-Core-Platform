import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
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

const enabled =
  process.env.RUN_MYSQL_PAYMENT_TESTS === '1' && typeof process.env.MYSQL_DATABASE_URL === 'string';
const chromiumPath = process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium';
const browserEnabled = enabled && existsSync(chromiumPath);
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
        {
          id: tenantA,
          slug: `portal-a-${tenantA.slice(0, 8)}`,
          legalName: 'Test Clinic A',
          displayName: 'Clinic A',
        },
        {
          id: tenantB,
          slug: `portal-b-${tenantB.slice(0, 8)}`,
          legalName: 'Test Clinic B',
          displayName: 'Clinic B',
        },
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
        {
          id: subscriptionA,
          tenantId: tenantA,
          planId: planA,
          startsAt: new Date(now.getTime() - 60_000),
          endsAt: new Date(now.getTime() + 86_400_000),
        },
        {
          id: subscriptionB,
          tenantId: tenantB,
          planId: planB,
          startsAt: new Date(now.getTime() - 60_000),
          endsAt: new Date(now.getTime() + 86_400_000),
        },
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
    await app.register(fastifyStatic, {
      root: resolve(process.cwd(), 'public'),
      prefix: '/',
      decorateReply: false,
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    tenantPermissions.clear();
    tenantPermissions.add('tenant.subscriptions.read');
    tenantPermissions.add('tenant.subscriptions.payments.submit');
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await prisma.subscriptionTransfer.deleteMany({
      where: { tenantId: { in: [tenantA, tenantB] } },
    });
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
    tenantPermissions.add('tenant.subscriptions.payments.submit');
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
      subscriptionId: subscriptionA,
      status: 'PENDING_REVIEW',
    });
    expect(submitted).not.toHaveProperty('tenantId');
    expect(submitted).not.toHaveProperty('receiptBytes');
    const stored = await prisma.subscriptionTransfer.findUnique({
      where: { id: submitted.id },
      select: { tenantId: true, subscriptionId: true, receiptBytes: true },
    });
    expect(stored).not.toBeNull();
    if (!stored) throw new Error('Expected the submitted receipt to be stored in MySQL');
    expect(stored).toMatchObject({
      tenantId: tenantA,
      subscriptionId: subscriptionA,
    });
    expect(Buffer.from(stored.receiptBytes ?? [])).toEqual(Buffer.from(pdf));
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

  it.skipIf(!browserEnabled)(
    'loads the clinic subscription page and submits a receipt through the browser UI',
    async () => {
      await app.listen(0, '127.0.0.1');
      const address = app.getHttpServer().address();
      if (!address || typeof address === 'string')
        throw new Error('Could not start the browser test API');
      const profile = await mkdtemp(join(tmpdir(), 'thanarah-subscription-browser-'));
      const receiptPath = join(profile, 'browser-receipt.pdf');
      await writeFile(receiptPath, '%PDF-1.4\nSynthetic browser receipt');
      const chrome = spawn(
        chromiumPath,
        [
          '--headless=new',
          '--no-sandbox',
          '--disable-gpu',
          '--remote-allow-origins=*',
          '--remote-debugging-port=0',
          `--user-data-dir=${join(profile, 'profile')}`,
          'about:blank',
        ],
        { detached: true, stdio: 'ignore' },
      );
      let socket: WebSocket | undefined;
      try {
        const debuggingPort = await waitForDevToolsPort(
          join(profile, 'profile', 'DevToolsActivePort'),
        );
        const targetsResponse = await fetch(`http://127.0.0.1:${debuggingPort}/json/list`);
        const targets = (await targetsResponse.json()) as Array<{
          type: string;
          webSocketDebuggerUrl: string;
        }>;
        const page = targets.find(({ type }) => type === 'page');
        if (!page) throw new Error('Chromium did not create a page target');
        const cdp = await connectToDevTools(page.webSocketDebuggerUrl);
        socket = cdp.socket;
        await cdp.command('Page.enable');
        await cdp.command('Runtime.enable');
        await cdp.command('Page.addScriptToEvaluateOnNewDocument', {
          source: `(() => {
            const nativeFetch = window.fetch.bind(window);
            window.fetch = (input, init) => {
              const url = new URL(typeof input === 'string' ? input : input.url, window.location.href);
              if (url.pathname === '/api/v1/auth/refresh') {
                return Promise.resolve(new Response(JSON.stringify({ accessToken: 'valid' }), {
                  status: 200, headers: { 'Content-Type': 'application/json' }
                }));
              }
              return nativeFetch(input, init);
            };
            let api;
            Object.defineProperty(window, 'ThanarahApi', {
              configurable: true,
              get: () => api,
              set: (value) => {
                api = value;
                api.listWorkspaces = async () => ({ items: [{
                  tenantId: ${JSON.stringify(tenantA)},
                  displayName: 'Clinic A',
                  permissionCodes: ['tenant.subscriptions.read', 'tenant.subscriptions.payments.submit']
                }] });
              }
            });
          })();`,
        });
        const navigation = await cdp.command('Page.navigate', {
          url: `http://127.0.0.1:${address.port}/finance/`,
        });
        if (navigation.errorText)
          throw new Error(`Could not open the finance page: ${navigation.errorText}`);
        await waitForPageCondition(
          cdp,
          "document.body.innerText.includes('Synthetic Plan A') && Boolean(document.querySelector('input[name=\"receipt\"]'))",
        );
        const document = await cdp.command('DOM.getDocument');
        const rootNodeId = document.root?.nodeId;
        if (typeof rootNodeId !== 'number') throw new Error('Could not inspect the finance page');
        const input = await cdp.command('DOM.querySelector', {
          nodeId: rootNodeId,
          selector: 'input[name="receipt"]',
        });
        const inputNodeId = input.nodeId;
        if (typeof inputNodeId !== 'number')
          throw new Error('Subscription receipt input was not found');
        await cdp.command('DOM.setFileInputFiles', { nodeId: inputNodeId, files: [receiptPath] });
        await cdp.command('Runtime.evaluate', {
          expression: `document.querySelector('[data-form="subscription-transfer"] button[type="submit"]').click()`,
        });
        await waitForPageCondition(
          cdp,
          "document.body.innerText.includes('تم إرسال الإيصال للمراجعة اليدوية.')",
        );
        expect(
          await prisma.subscriptionTransfer.count({ where: { tenantId: tenantA } }),
        ).toBeGreaterThanOrEqual(2);
      } finally {
        socket?.close();
        await stopChromiumProcessGroup(chrome);
        await rm(profile, { recursive: true, force: true });
      }
    },
    60_000,
  );

  it('does not allow tenant submission without tenant submit permission', async () => {
    tenantPermissions.delete('tenant.subscriptions.payments.submit');
    const transfersBefore = await prisma.subscriptionTransfer.count({
      where: { tenantId: tenantA },
    });
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/tenants/${tenantA}/subscription-portal/transfers`,
      headers: { authorization: 'Bearer valid' },
      payload: {},
    });
    expect(response.statusCode).toBe(403);
    expect(await prisma.subscriptionTransfer.count({ where: { tenantId: tenantA } })).toBe(
      transfersBefore,
    );
    tenantPermissions.add('tenant.subscriptions.payments.submit');
  });
});

interface DevToolsResponse {
  errorText?: string;
  root?: { nodeId: number };
  nodeId?: number;
  result?: {
    value?: unknown;
  };
}

async function connectToDevTools(url: string): Promise<{
  socket: WebSocket;
  command: (method: string, params?: Record<string, unknown>) => Promise<DevToolsResponse>;
}> {
  const socket = new WebSocket(url);
  await new Promise<void>((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', () => resolveOpen(), { once: true });
    socket.addEventListener(
      'error',
      () => rejectOpen(new Error('Could not connect to Chromium DevTools')),
      {
        once: true,
      },
    );
  });
  let nextId = 0;
  const pending = new Map<
    number,
    { resolve: (value: DevToolsResponse) => void; reject: (error: Error) => void }
  >();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as {
      id?: number;
      result?: DevToolsResponse;
      error?: { message?: string };
    };
    if (message.id === undefined) return;
    const callbacks = pending.get(message.id);
    if (!callbacks) return;
    pending.delete(message.id);
    if (message.error)
      callbacks.reject(new Error(message.error.message || 'Chromium command failed'));
    else callbacks.resolve(message.result);
  });
  return {
    socket,
    command: (method, params = {}) =>
      new Promise((resolveCommand, rejectCommand) => {
        const id = ++nextId;
        pending.set(id, { resolve: resolveCommand, reject: rejectCommand });
        socket.send(JSON.stringify({ id, method, params }));
      }),
  };
}

async function waitForDevToolsPort(activePortFile: string): Promise<number> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const [port] = (await readFile(activePortFile, 'utf8')).trim().split('\n');
      const parsed = Number(port);
      if (Number.isInteger(parsed) && parsed > 0) return parsed;
    } catch {
      // Chromium creates DevToolsActivePort after startup.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error('Chromium did not expose a DevTools port');
}

async function waitForPageCondition(
  cdp: Awaited<ReturnType<typeof connectToDevTools>>,
  expression: string,
): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const evaluation = await cdp.command('Runtime.evaluate', {
      expression,
      returnByValue: true,
    });
    if (evaluation.result?.value === true) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  const pageText = await cdp.command('Runtime.evaluate', {
    expression:
      'JSON.stringify({ href: location.href, state: document.readyState, text: document.body.innerText })',
    returnByValue: true,
  });
  throw new Error(
    `Timed out waiting for browser UI: ${expression}; page: ${String(pageText.result?.value || '')}`,
  );
}

async function stopChromiumProcessGroup(child: ReturnType<typeof spawn>): Promise<void> {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    return;
  }
  if (child.exitCode === null) {
    await Promise.race([
      new Promise<void>((resolveExit) => child.once('exit', () => resolveExit())),
      new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 2_000)),
    ]);
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    // The browser process group has already exited.
  }
}
