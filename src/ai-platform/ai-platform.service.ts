import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import {
  AiAgentNotFoundError,
  AiBudgetExceededError,
  AiBudgetNotConfiguredError,
  AiInputLimitExceededError,
  AiKnowledgeSafetyError,
  AiPersonalDataBlockedError,
  AiProviderUnavailableError,
  AiSyntheticInputRequiredError,
} from './ai-platform.errors';
import type {
  AiAgent,
  AiAuditRecord,
  AiBudget,
  AiInferenceRuntime,
  AiKnowledgeSource,
  AiProviderId,
  AiProviderStatus,
  AiTenantStore,
  AiUsageRecord,
} from './ai-platform.types';
import { AI_INFERENCE_RUNTIME, AI_TENANT_STORE } from './ai-platform.types';
import type {
  CreateAiAgentInput,
  CreateAiKnowledgeInput,
  RunAiAgentInput,
  SaveAiBudgetInput,
  UpdateAiAgentInput,
} from './ai-platform.dto';

const TOOL_REGISTRY = [
  { id: 'knowledge.search', label: 'Search tenant-approved knowledge' },
] as const;
const KNOWLEDGE_PERSONAL_DATA_PATTERNS = [
  /\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/iu,
  /\b(?:patient|mrn|medical\s*record|national\s*id|iqama|diagnosis|date\s*of\s*birth)\s*[:#-]/iu,
  /(?:\+?\d[\d\s().-]{7,}\d)/u,
  /\b\d{9,}\b/u,
] as const;

@Injectable()
export class AiPlatformService {
  constructor(
    @Inject(AI_TENANT_STORE) private readonly store: AiTenantStore,
    @Inject(AI_INFERENCE_RUNTIME) private readonly runtime: AiInferenceRuntime,
    private readonly config: ConfigService,
  ) {}

  listProviders(): AiProviderStatus[] {
    return [
      {
        id: 'openai-compatible',
        label: 'OpenAI-compatible hosted model',
        configured: Boolean(this.config.aiOpenAiApiKey.trim()),
        enabled:
          this.config.aiExternalInferenceEnabled && Boolean(this.config.aiOpenAiApiKey.trim()),
      },
      {
        id: 'ollama',
        label: 'Ollama on this server',
        configured: this.config.aiOllamaEnabled,
        enabled: this.config.aiOllamaEnabled,
      },
    ];
  }

  listTools(): typeof TOOL_REGISTRY {
    return TOOL_REGISTRY;
  }

  listAgents(context: Parameters<AiTenantStore['listAgents']>[0]): Promise<AiAgent[]> {
    return this.store.listAgents(context);
  }

  async createAgent(
    context: Parameters<AiTenantStore['listAgents']>[0],
    input: CreateAiAgentInput,
    actorUserId: string,
  ): Promise<AiAgent> {
    if (containsPotentialPersonalInformation(`${input.description}\n${input.instructions}`)) {
      throw new AiPersonalDataBlockedError();
    }
    const saved = await this.store.saveAgent(context, {
      id: randomUUID(),
      ...input,
      allowedTools: input.allowedTools,
    });
    await this.audit(context, actorUserId, 'AGENT_CREATED', saved.id, {
      provider: saved.provider,
      model: saved.model,
    });
    return saved;
  }

  async updateAgent(
    context: Parameters<AiTenantStore['listAgents']>[0],
    id: string,
    input: UpdateAiAgentInput,
    actorUserId: string,
  ): Promise<AiAgent> {
    const existing = await this.store.findAgent(context, id);
    if (!existing) throw new AiAgentNotFoundError();
    const instructions = input.instructions ?? existing.instructions;
    const description = input.description ?? existing.description;
    if (containsPotentialPersonalInformation(`${description}\n${instructions}`)) {
      throw new AiPersonalDataBlockedError();
    }
    const saved = await this.store.saveAgent(context, {
      id: existing.id,
      name: input.name ?? existing.name,
      description,
      instructions,
      provider: input.provider ?? existing.provider,
      model: input.model ?? existing.model,
      status: input.status ?? existing.status,
      allowedTools: input.allowedTools ?? existing.allowedTools,
    });
    await this.audit(context, actorUserId, 'AGENT_UPDATED', saved.id, {
      provider: saved.provider,
      model: saved.model,
    });
    return saved;
  }

  listKnowledge(context: Parameters<AiTenantStore['listAgents']>[0]): Promise<AiKnowledgeSource[]> {
    return this.store.listKnowledge(context);
  }

  async createKnowledge(
    context: Parameters<AiTenantStore['listAgents']>[0],
    input: CreateAiKnowledgeInput,
    actorUserId: string,
  ): Promise<AiKnowledgeSource> {
    if (containsPotentialPersonalInformation(input.content)) {
      throw new AiKnowledgeSafetyError();
    }
    const source = await this.store.createKnowledge(context, {
      id: randomUUID(),
      title: input.title,
      kind: input.kind,
      content: input.content,
      status: 'ACTIVE',
    });
    await this.audit(context, actorUserId, 'KNOWLEDGE_CREATED', source.id);
    return source;
  }

  async deleteKnowledge(
    context: Parameters<AiTenantStore['listAgents']>[0],
    id: string,
    actorUserId: string,
  ): Promise<boolean> {
    const removed = await this.store.deleteKnowledge(context, id);
    if (removed) await this.audit(context, actorUserId, 'KNOWLEDGE_DELETED', id);
    return removed;
  }

  getBudget(context: Parameters<AiTenantStore['listAgents']>[0]): Promise<AiBudget> {
    return this.store.getBudget(context);
  }

  async saveBudget(
    context: Parameters<AiTenantStore['listAgents']>[0],
    input: SaveAiBudgetInput,
    actorUserId: string,
  ): Promise<AiBudget> {
    const budget = await this.store.saveBudget(context, input);
    await this.audit(context, actorUserId, 'BUDGET_UPDATED', context.tenantId, {
      tokenEstimate: input.monthlyTokenLimit,
    });
    return budget;
  }

  async getUsage(context: Parameters<AiTenantStore['listAgents']>[0]): Promise<{
    monthly: Awaited<ReturnType<AiTenantStore['getMonthlyUsage']>>;
    items: AiUsageRecord[];
  }> {
    const budget = await this.store.getBudget(context);
    const month = currentMonth();
    const [monthly, items] = await Promise.all([
      this.store.getMonthlyUsage(context, month, budget.monthlyTokenLimit ?? 0),
      this.store.listUsage(context, 100),
    ]);
    return { monthly, items };
  }

  listAudit(context: Parameters<AiTenantStore['listAgents']>[0]): Promise<AiAuditRecord[]> {
    return this.store.listAudit(context, 100);
  }

  async runAgent(
    context: Parameters<AiTenantStore['listAgents']>[0],
    id: string,
    input: RunAiAgentInput,
    actorUserId: string,
  ): Promise<{ text: string; sources: Array<{ id: string; title: string }> }> {
    if (!input.prompt.startsWith('[SYNTHETIC]')) {
      await this.audit(context, actorUserId, 'INFERENCE_REJECTED', id);
      throw new AiSyntheticInputRequiredError();
    }
    if (containsPotentialPersonalInformation(input.prompt)) throw new AiPersonalDataBlockedError();
    const agent = await this.store.findAgent(context, id);
    if (!agent) throw new AiAgentNotFoundError();
    if (agent.status !== 'ACTIVE') throw new AiProviderUnavailableError();
    const provider = this.listProviders().find((candidate) => candidate.id === agent.provider);
    if (!provider?.enabled) {
      await this.audit(context, actorUserId, 'INFERENCE_REJECTED', agent.id, {
        provider: agent.provider,
        model: agent.model,
      });
      throw new AiProviderUnavailableError();
    }

    const budget = await this.store.getBudget(context);
    if (!budget.monthlyTokenLimit) throw new AiBudgetNotConfiguredError();
    const sources = agent.allowedTools.includes('knowledge.search')
      ? await this.store.searchKnowledge(context, input.prompt, 4)
      : [];
    const prompt = buildPrompt(input.prompt, sources);
    const inputEstimate = estimateTokens(`${agent.instructions}\n${prompt}`);
    if (inputEstimate > budget.maxInputTokens) throw new AiInputLimitExceededError();

    const maxOutputTokens = budget.maxOutputTokens;
    const reservation = inputEstimate + maxOutputTokens;
    const month = currentMonth();
    if (!(await this.store.reserveTokens(context, month, budget.monthlyTokenLimit, reservation))) {
      await this.audit(context, actorUserId, 'INFERENCE_REJECTED', agent.id, {
        provider: agent.provider,
        model: agent.model,
        tokenEstimate: reservation,
      });
      throw new AiBudgetExceededError();
    }

    let result;
    try {
      result = await this.runtime.generate({
        provider: agent.provider,
        model: agent.model,
        instructions: agent.instructions,
        prompt,
        maxOutputTokens,
      });
    } catch (error) {
      await this.store.settleTokens(context, month, reservation, 0);
      await this.store.recordUsage(context, {
        id: randomUUID(),
        agentId: agent.id,
        provider: agent.provider,
        model: agent.model,
        inputTokenEstimate: inputEstimate,
        outputTokenEstimate: 0,
        status: 'FAILED',
        occurredAt: new Date().toISOString(),
      });
      await this.audit(context, actorUserId, 'INFERENCE_FAILED', agent.id, {
        provider: agent.provider,
        model: agent.model,
        tokenEstimate: inputEstimate,
      });
      if (error instanceof AiProviderUnavailableError) throw error;
      throw new AiProviderUnavailableError();
    }

    const outputEstimate = Math.min(
      maxOutputTokens,
      result.outputTokens ?? estimateTokens(result.text),
    );
    const actualUsage = Math.min(reservation, inputEstimate + outputEstimate);
    await this.store.settleTokens(context, month, reservation, actualUsage);
    await this.store.recordUsage(context, {
      id: randomUUID(),
      agentId: agent.id,
      provider: agent.provider,
      model: agent.model,
      inputTokenEstimate: Math.min(inputEstimate, result.inputTokens ?? inputEstimate),
      outputTokenEstimate: outputEstimate,
      status: 'SUCCEEDED',
      occurredAt: new Date().toISOString(),
    });
    await this.audit(context, actorUserId, 'INFERENCE_SUCCEEDED', agent.id, {
      provider: agent.provider,
      model: agent.model,
      tokenEstimate: actualUsage,
    });
    return {
      text: result.text,
      sources: sources.map(({ id: sourceId, title }) => ({ id: sourceId, title })),
    };
  }

  private audit(
    context: Parameters<AiTenantStore['listAgents']>[0],
    actorUserId: string,
    action: AiAuditRecord['action'],
    targetId: string,
    metadata: { provider?: AiProviderId; model?: string; tokenEstimate?: number } = {},
  ): Promise<void> {
    return this.store.recordAudit(context, {
      id: randomUUID(),
      actorUserId,
      action,
      targetId,
      ...metadata,
      occurredAt: new Date().toISOString(),
    });
  }
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(Buffer.byteLength(value, 'utf8') / 4));
}

function containsPotentialPersonalInformation(value: string): boolean {
  return KNOWLEDGE_PERSONAL_DATA_PATTERNS.some((pattern) => pattern.test(value));
}

function buildPrompt(prompt: string, sources: AiKnowledgeSource[]): string {
  if (sources.length === 0) return prompt;
  const references = sources
    .map((source, index) => `[${index + 1}] ${source.title}\n${source.content}`)
    .join('\n\n');
  return `${prompt}\n\nTenant-approved reference text:\n${references}`;
}
