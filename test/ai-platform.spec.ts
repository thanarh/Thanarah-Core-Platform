import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '../src/config/config.service';
import type { AiInferenceRuntime, AiProviderId } from '../src/ai-platform/ai-platform.types';
import { AiPlatformController } from '../src/ai-platform/ai-platform.controller';
import { AiPlatformService } from '../src/ai-platform/ai-platform.service';
import {
  AiBudgetExceededError,
  AiBudgetNotConfiguredError,
  AiKnowledgeSafetyError,
  AiProviderUnavailableError,
  AiSyntheticInputRequiredError,
} from '../src/ai-platform/ai-platform.errors';
import { InMemoryAiTenantStore, MongoAiTenantStore } from '../src/ai-platform/ai-tenant-store';
import { TENANT_REQUIRED_PERMISSIONS } from '../src/tenant/tenant-require-permissions.decorator';
import {
  DEFAULT_TENANT_ROLES,
  TENANT_PERMISSION_CODES,
} from '../src/tenant/tenant-authorization.constants';
import type { TrustedTenantContext } from '../src/tenant/tenant-context.contract';
import { TenantStorageNotConfiguredError } from '../src/tenant/tenant-storage.errors';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

function tenantContext(tenantId: string): TrustedTenantContext {
  return {
    tenantId,
    membershipId: '33333333-3333-4333-8333-333333333333',
    platformUserId: '44444444-4444-4444-8444-444444444444',
  } as TrustedTenantContext;
}

function activeAgent(provider: AiProviderId = 'ollama') {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    name: 'Synthetic clinic helper',
    description: 'Synthetic test agent',
    instructions: 'Answer using only approved reference text.',
    provider,
    model: provider === 'ollama' ? 'local-test-model' : 'hosted-test-model',
    status: 'ACTIVE' as const,
    allowedTools: ['knowledge.search'] as const,
  };
}

function makeService(
  options: {
    store?: InMemoryAiTenantStore;
    runtime?: AiInferenceRuntime;
    externalEnabled?: boolean;
    apiKey?: string;
    ollamaEnabled?: boolean;
  } = {},
) {
  const store = options.store ?? new InMemoryAiTenantStore();
  const runtime = options.runtime ?? {
    generate: vi
      .fn()
      .mockResolvedValue({ text: 'Synthetic answer', inputTokens: 12, outputTokens: 4 }),
  };
  const config = {
    aiOpenAiApiKey: options.apiKey ?? '',
    aiExternalInferenceEnabled: options.externalEnabled ?? false,
    aiOpenAiBaseUrl: 'https://api.openai.com/v1',
    aiOllamaEnabled: options.ollamaEnabled ?? false,
  } as ConfigService;
  return { service: new AiPlatformService(store, runtime, config), store, runtime };
}

describe('Thanarah tenant AI platform', () => {
  it('defines separate tenant permissions and grants AI management only to owner/admin defaults', () => {
    const required = [
      'tenant.ai.read',
      'tenant.ai.manage',
      'tenant.ai.knowledge.manage',
      'tenant.ai.budget.manage',
      'tenant.ai.run',
    ] as const;
    for (const code of required) expect(TENANT_PERMISSION_CODES).toContain(code);
    const owner = DEFAULT_TENANT_ROLES.find(({ code }) => code === 'OWNER');
    const admin = DEFAULT_TENANT_ROLES.find(({ code }) => code === 'ADMIN');
    const member = DEFAULT_TENANT_ROLES.find(({ code }) => code === 'MEMBER');
    for (const code of required) {
      expect(owner?.permissionCodes).toContain(code);
      expect(admin?.permissionCodes).toContain(code);
      expect(member?.permissionCodes).not.toContain(code);
    }
    expect(
      Reflect.getMetadata(TENANT_REQUIRED_PERMISSIONS, AiPlatformController.prototype.listAgents),
    ).toEqual(['tenant.ai.read']);
    expect(
      Reflect.getMetadata(TENANT_REQUIRED_PERMISSIONS, AiPlatformController.prototype.createAgent),
    ).toEqual(['tenant.ai.manage']);
    expect(
      Reflect.getMetadata(
        TENANT_REQUIRED_PERMISSIONS,
        AiPlatformController.prototype.createKnowledge,
      ),
    ).toEqual(['tenant.ai.knowledge.manage']);
    expect(
      Reflect.getMetadata(TENANT_REQUIRED_PERMISSIONS, AiPlatformController.prototype.saveBudget),
    ).toEqual(['tenant.ai.budget.manage']);
    expect(
      Reflect.getMetadata(TENANT_REQUIRED_PERMISSIONS, AiPlatformController.prototype.runAgent),
    ).toEqual(['tenant.ai.run']);

    const migration = readFileSync(
      'prisma/migrations/20261109150000_ai_platform_permissions/migration.sql',
      'utf8',
    );
    for (const code of required) expect(migration).toContain(code);
  });

  it('keeps agents and knowledge sources tenant-scoped', async () => {
    const store = new InMemoryAiTenantStore();
    const tenantA = tenantContext(TENANT_A);
    const tenantB = tenantContext(TENANT_B);
    const agent = await store.saveAgent(tenantA, activeAgent());
    await store.createKnowledge(tenantA, {
      id: '66666666-6666-4666-8666-666666666666',
      title: 'Clinic hours',
      kind: 'FAQ',
      content: 'The clinic opens in the morning.',
      status: 'ACTIVE',
    });

    expect(await store.findAgent(tenantB, agent.id)).toBeNull();
    expect(await store.listKnowledge(tenantB)).toEqual([]);
    expect(await store.searchKnowledge(tenantB, 'clinic hours', 5)).toEqual([]);
  });

  it('constrains Mongo-backed AI reads to the validated tenant and placement', async () => {
    const rows = { sort: vi.fn(), limit: vi.fn(), toArray: vi.fn().mockResolvedValue([]) };
    rows.sort.mockReturnValue(rows);
    rows.limit.mockReturnValue(rows);
    const agents = { createIndex: vi.fn().mockResolvedValue('index'), find: vi.fn(() => rows) };
    const database = { collection: vi.fn(() => agents) };
    const placementId = '77777777-7777-4777-8777-777777777777';
    const context = tenantContext(TENANT_A);
    const routes = { resolve: vi.fn().mockResolvedValue({ placements: [{ placementId }] }) };
    const target = {
      id: placementId,
      tenantId: TENANT_A,
      provider: 'MONGODB',
      connectionReference: 'primary',
      databaseName: 'tenant_fixture',
      status: 'ACTIVE',
      isPrimary: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const targets = { findActivePrimaryTarget: vi.fn().mockResolvedValue(target) };
    const clients = { getDatabase: vi.fn().mockResolvedValue(database) };
    const store = new MongoAiTenantStore(routes as never, targets as never, clients as never);

    await store.listAgents(context);

    expect(routes.resolve).toHaveBeenCalledWith(context);
    expect(targets.findActivePrimaryTarget).toHaveBeenCalledWith(context, placementId);
    expect(agents.find).toHaveBeenCalledWith({ _tenantId: TENANT_A });
  });

  it('continues atomic monthly budget reservation after a concurrent first-use insert', async () => {
    const duplicateKeyError = Object.assign(new Error('duplicate key'), { code: 11000 });
    const monthlyUsage = {
      createIndex: vi.fn().mockResolvedValue('index'),
      updateOne: vi
        .fn()
        .mockRejectedValueOnce(duplicateKeyError)
        .mockResolvedValueOnce({ modifiedCount: 1 }),
    };
    const database = { collection: vi.fn(() => monthlyUsage) };
    const placementId = '77777777-7777-4777-8777-777777777777';
    const context = tenantContext(TENANT_A);
    const routes = { resolve: vi.fn().mockResolvedValue({ placements: [{ placementId }] }) };
    const target = {
      id: placementId,
      tenantId: TENANT_A,
      provider: 'MONGODB',
      connectionReference: 'primary',
      databaseName: 'tenant_fixture',
      status: 'ACTIVE',
      isPrimary: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const targets = { findActivePrimaryTarget: vi.fn().mockResolvedValue(target) };
    const clients = { getDatabase: vi.fn().mockResolvedValue(database) };
    const store = new MongoAiTenantStore(routes as never, targets as never, clients as never);

    await expect(store.reserveTokens(context, '2026-11', 100, 10)).resolves.toBe(true);

    expect(monthlyUsage.updateOne).toHaveBeenCalledTimes(2);
    expect(monthlyUsage.updateOne).toHaveBeenLastCalledWith(
      expect.objectContaining({ _tenantId: TENANT_A, month: '2026-11' }),
      expect.objectContaining({ $inc: { reservedTokens: 10 } }),
    );
  });

  it('fails closed when a placement resolves to another tenant', async () => {
    const routes = {
      resolve: vi.fn().mockResolvedValue({
        placements: [{ placementId: '77777777-7777-4777-8777-777777777777' }],
      }),
    };
    const targets = {
      findActivePrimaryTarget: vi.fn().mockResolvedValue({
        tenantId: TENANT_B,
        status: 'ACTIVE',
        isPrimary: true,
      }),
    };
    const clients = { getDatabase: vi.fn() };
    const store = new MongoAiTenantStore(routes as never, targets as never, clients as never);

    await expect(store.listAgents(tenantContext(TENANT_A))).rejects.toBeInstanceOf(
      TenantStorageNotConfiguredError,
    );
    expect(clients.getDatabase).not.toHaveBeenCalled();
  });

  it('keeps hosted providers disabled until both explicit enablement and a secret exist', () => {
    const { service } = makeService({ apiKey: 'test-only-secret', externalEnabled: false });
    const hosted = service.listProviders().find(({ id }) => id === 'openai-compatible');
    expect(hosted).toEqual({
      id: 'openai-compatible',
      label: 'OpenAI-compatible hosted model',
      configured: true,
      enabled: false,
    });
  });

  it('rejects patient-like knowledge and accepts safe synthetic reference text', async () => {
    const { service } = makeService();
    const context = tenantContext(TENANT_A);
    await expect(
      service.createKnowledge(
        context,
        { title: 'Contact', kind: 'FAQ', content: 'Call someone@example.com for details.' },
        context.platformUserId,
      ),
    ).rejects.toBeInstanceOf(AiKnowledgeSafetyError);

    const saved = await service.createKnowledge(
      context,
      { title: 'Opening hours', kind: 'FAQ', content: 'The clinic opens from morning to evening.' },
      context.platformUserId,
    );
    expect(saved.title).toBe('Opening hours');
  });

  it('accepts synthetic prompts only and requires an explicit tenant budget', async () => {
    const store = new InMemoryAiTenantStore();
    const context = tenantContext(TENANT_A);
    await store.saveAgent(context, activeAgent());
    const { service } = makeService({ store, ollamaEnabled: true });
    await expect(
      service.runAgent(
        context,
        activeAgent().id,
        { prompt: 'A real patient asks about a visit' },
        context.platformUserId,
      ),
    ).rejects.toBeInstanceOf(AiSyntheticInputRequiredError);
    await expect(
      service.runAgent(
        context,
        activeAgent().id,
        { prompt: '[SYNTHETIC] test question' },
        context.platformUserId,
      ),
    ).rejects.toBeInstanceOf(AiBudgetNotConfiguredError);
  });

  it('selects the configured provider, enforces a monthly budget, and stores redacted telemetry', async () => {
    const store = new InMemoryAiTenantStore();
    const context = tenantContext(TENANT_A);
    const agent = activeAgent('ollama');
    await store.saveAgent(context, agent);
    await store.saveBudget(context, {
      monthlyTokenLimit: 40,
      maxInputTokens: 50,
      maxOutputTokens: 10,
    });
    const runtime = {
      generate: vi
        .fn()
        .mockResolvedValue({ text: 'Synthetic answer', inputTokens: 5, outputTokens: 4 }),
    };
    const { service } = makeService({ store, runtime, ollamaEnabled: true });

    const first = await service.runAgent(
      context,
      agent.id,
      { prompt: '[SYNTHETIC] clinic hours question' },
      context.platformUserId,
    );
    expect(first.text).toBe('Synthetic answer');
    expect(runtime.generate).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'ollama', model: 'local-test-model' }),
    );

    await expect(
      service.runAgent(
        context,
        agent.id,
        { prompt: '[SYNTHETIC] clinic hours question' },
        context.platformUserId,
      ),
    ).rejects.toBeInstanceOf(AiBudgetExceededError);
    const usage = await store.listUsage(context, 10);
    expect(usage).toHaveLength(1);
    expect(usage[0]).not.toHaveProperty('prompt');
    expect(usage[0]).not.toHaveProperty('completion');
    expect(
      (await store.getMonthlyUsage(context, new Date().toISOString().slice(0, 7), 40)).usedTokens,
    ).toBeGreaterThan(0);
    const audit = await store.listAudit(context, 10);
    expect(audit[0]).not.toHaveProperty('prompt');
    expect(audit[0]).not.toHaveProperty('completion');
  });

  it('releases reserved tokens when a provider fails', async () => {
    const store = new InMemoryAiTenantStore();
    const context = tenantContext(TENANT_A);
    const agent = activeAgent();
    await store.saveAgent(context, agent);
    await store.saveBudget(context, {
      monthlyTokenLimit: 100,
      maxInputTokens: 50,
      maxOutputTokens: 10,
    });
    const runtime = { generate: vi.fn().mockRejectedValue(new AiProviderUnavailableError()) };
    const { service } = makeService({ store, runtime, ollamaEnabled: true });

    await expect(
      service.runAgent(
        context,
        agent.id,
        { prompt: '[SYNTHETIC] provider failure test' },
        context.platformUserId,
      ),
    ).rejects.toBeInstanceOf(AiProviderUnavailableError);
    const monthly = await store.getMonthlyUsage(context, new Date().toISOString().slice(0, 7), 100);
    expect(monthly.reservedTokens).toBe(0);
    expect(monthly.usedTokens).toBe(0);
    expect((await store.listUsage(context, 10))[0]?.status).toBe('FAILED');
  });

  it('switches provider adapters without changing tenant ownership', async () => {
    const store = new InMemoryAiTenantStore();
    const context = tenantContext(TENANT_A);
    const agent = activeAgent('ollama');
    await store.saveAgent(context, agent);
    await store.saveBudget(context, {
      monthlyTokenLimit: 1000,
      maxInputTokens: 100,
      maxOutputTokens: 20,
    });
    const runtime = {
      generate: vi
        .fn()
        .mockResolvedValue({ text: 'Synthetic answer', inputTokens: 5, outputTokens: 4 }),
    };
    const { service } = makeService({
      store,
      runtime,
      ollamaEnabled: true,
      externalEnabled: true,
      apiKey: 'test-only-secret',
    });

    await service.runAgent(
      context,
      agent.id,
      { prompt: '[SYNTHETIC] first adapter test' },
      context.platformUserId,
    );
    await service.updateAgent(
      context,
      agent.id,
      { provider: 'openai-compatible', model: 'hosted-test-model' },
      context.platformUserId,
    );
    await service.runAgent(
      context,
      agent.id,
      { prompt: '[SYNTHETIC] second adapter test' },
      context.platformUserId,
    );

    expect(runtime.generate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ provider: 'ollama' }),
    );
    expect(runtime.generate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ provider: 'openai-compatible', model: 'hosted-test-model' }),
    );
  });

  it('never passes free-form database tools to an agent', async () => {
    const { service } = makeService();
    expect(service.listTools()).toEqual([
      { id: 'knowledge.search', label: 'Search tenant-approved knowledge' },
    ]);
  });
});
