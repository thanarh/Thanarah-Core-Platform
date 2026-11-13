import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Collection, Document } from 'mongodb';
import type { TrustedTenantContext } from '../tenant/tenant-context.contract';
import {
  TenantContextInvalidError,
  isWellFormedTrustedTenantContext,
} from '../tenant/tenant-context.contract';
import {
  TenantStorageNotConfiguredError,
  TenantStorageUnavailableError,
} from '../tenant/tenant-storage.errors';
import type { TenantStorageResolver, TenantStorageRoute } from '../tenant/tenant-storage.contract';
import { TENANT_STORAGE_RESOLVER } from '../tenant/tenant-storage.resolver';
import { TenantMongoClientManager } from '../tenant/tenant-mongo-client.manager';
import {
  TENANT_STORAGE_TARGET_RESOLVER,
  type TenantStorageTargetRecord,
  type TenantStorageTargetResolver,
} from '../tenant/tenant-storage.registry.contract';
import type {
  AiAgent,
  AiAuditRecord,
  AiBudget,
  AiKnowledgeSource,
  AiMonthlyUsage,
  AiTenantStore,
  AiUsageRecord,
} from './ai-platform.types';

interface ScopedDocument extends Document {
  _id: string;
  _tenantId: string;
}

interface AgentDocument extends ScopedDocument, Omit<AiAgent, 'id' | 'tenantId'> {}
interface KnowledgeDocument extends ScopedDocument, Omit<AiKnowledgeSource, 'id' | 'tenantId'> {}
interface BudgetDocument extends ScopedDocument {
  monthlyTokenLimit: number | null;
  maxInputTokens: number;
  maxOutputTokens: number;
  updatedAt: string;
}
interface UsageDocument extends ScopedDocument, Omit<AiUsageRecord, 'id' | 'tenantId'> {}
interface AuditDocument extends ScopedDocument, Omit<AiAuditRecord, 'id' | 'tenantId'> {}
interface UsageMonthDocument extends ScopedDocument {
  month: string;
  usedTokens: number;
  reservedTokens: number;
  updatedAt: string;
}

const AGENTS = 'ai_agents';
const KNOWLEDGE = 'ai_knowledge_sources';
const BUDGETS = 'ai_budgets';
const USAGE = 'ai_usage';
const MONTHLY_USAGE = 'ai_monthly_usage';
const AUDIT = 'ai_audit_events';

@Injectable()
export class MongoAiTenantStore implements AiTenantStore {
  constructor(
    @Inject(TENANT_STORAGE_RESOLVER) private readonly routes: TenantStorageResolver,
    @Inject(TENANT_STORAGE_TARGET_RESOLVER)
    private readonly targets: TenantStorageTargetResolver,
    private readonly clients: TenantMongoClientManager,
  ) {}

  async listAgents(context: TrustedTenantContext): Promise<AiAgent[]> {
    const collection = await this.collection<AgentDocument>(context, AGENTS);
    const documents = await collection
      .find({ _tenantId: context.tenantId })
      .sort({ updatedAt: -1, _id: 1 })
      .limit(100)
      .toArray();
    return documents.map((document) => agentFromDocument(context.tenantId, document));
  }

  async findAgent(context: TrustedTenantContext, id: string): Promise<AiAgent | null> {
    const document = await (
      await this.collection<AgentDocument>(context, AGENTS)
    ).findOne({
      _tenantId: context.tenantId,
      _id: id,
    });
    return document ? agentFromDocument(context.tenantId, document) : null;
  }

  async saveAgent(
    context: TrustedTenantContext,
    input: Omit<AiAgent, 'tenantId' | 'createdAt' | 'updatedAt'>,
  ): Promise<AiAgent> {
    const collection = await this.collection<AgentDocument>(context, AGENTS);
    const now = new Date().toISOString();
    const existing = await collection.findOne({ _tenantId: context.tenantId, _id: input.id });
    const document: AgentDocument = {
      _id: input.id,
      _tenantId: context.tenantId,
      name: input.name,
      description: input.description,
      instructions: input.instructions,
      provider: input.provider,
      model: input.model,
      status: input.status,
      allowedTools: input.allowedTools,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await collection.replaceOne({ _tenantId: context.tenantId, _id: input.id }, document, {
      upsert: true,
    });
    return agentFromDocument(context.tenantId, document);
  }

  async listKnowledge(context: TrustedTenantContext): Promise<AiKnowledgeSource[]> {
    const documents = await (
      await this.collection<KnowledgeDocument>(context, KNOWLEDGE)
    )
      .find({ _tenantId: context.tenantId })
      .sort({ updatedAt: -1, _id: 1 })
      .limit(200)
      .toArray();
    return documents.map((document) => knowledgeFromDocument(context.tenantId, document));
  }

  async createKnowledge(
    context: TrustedTenantContext,
    input: Omit<AiKnowledgeSource, 'tenantId' | 'createdAt' | 'updatedAt'>,
  ): Promise<AiKnowledgeSource> {
    const now = new Date().toISOString();
    const document: KnowledgeDocument = {
      _id: input.id,
      _tenantId: context.tenantId,
      title: input.title,
      kind: input.kind,
      content: input.content,
      status: input.status,
      createdAt: now,
      updatedAt: now,
    };
    await (await this.collection<KnowledgeDocument>(context, KNOWLEDGE)).insertOne(document);
    return knowledgeFromDocument(context.tenantId, document);
  }

  async deleteKnowledge(context: TrustedTenantContext, id: string): Promise<boolean> {
    const result = await (
      await this.collection<KnowledgeDocument>(context, KNOWLEDGE)
    ).deleteOne({
      _tenantId: context.tenantId,
      _id: id,
    });
    return result.deletedCount === 1;
  }

  async searchKnowledge(
    context: TrustedTenantContext,
    query: string,
    limit: number,
  ): Promise<AiKnowledgeSource[]> {
    const terms = tokenize(query);
    if (terms.length === 0) return [];
    const collection = await this.collection<KnowledgeDocument>(context, KNOWLEDGE);
    const candidates = await collection
      .find({ _tenantId: context.tenantId, status: 'ACTIVE' })
      .limit(500)
      .toArray();
    return candidates
      .map((document) => ({
        document,
        score: lexicalScore(terms, `${document.title} ${document.content}`),
      }))
      .filter((candidate) => candidate.score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          right.document.updatedAt.localeCompare(left.document.updatedAt) ||
          left.document._id.localeCompare(right.document._id),
      )
      .slice(0, limit)
      .map(({ document }) => knowledgeFromDocument(context.tenantId, document));
  }

  async getBudget(context: TrustedTenantContext): Promise<AiBudget> {
    const document = await (
      await this.collection<BudgetDocument>(context, BUDGETS)
    ).findOne({
      _tenantId: context.tenantId,
    });
    if (document) return budgetFromDocument(context.tenantId, document);
    const now = new Date().toISOString();
    return {
      tenantId: context.tenantId,
      monthlyTokenLimit: null,
      maxInputTokens: 2048,
      maxOutputTokens: 512,
      updatedAt: now,
    };
  }

  async saveBudget(
    context: TrustedTenantContext,
    input: Pick<AiBudget, 'monthlyTokenLimit' | 'maxInputTokens' | 'maxOutputTokens'>,
  ): Promise<AiBudget> {
    const now = new Date().toISOString();
    const document: BudgetDocument = {
      _id: context.tenantId,
      _tenantId: context.tenantId,
      ...input,
      updatedAt: now,
    };
    await (
      await this.collection<BudgetDocument>(context, BUDGETS)
    ).replaceOne({ _tenantId: context.tenantId, _id: context.tenantId }, document, {
      upsert: true,
    });
    return budgetFromDocument(context.tenantId, document);
  }

  async getMonthlyUsage(
    context: TrustedTenantContext,
    month: string,
    limit: number,
  ): Promise<AiMonthlyUsage> {
    const document = await (
      await this.collection<UsageMonthDocument>(context, MONTHLY_USAGE)
    ).findOne({
      _tenantId: context.tenantId,
      month,
    });
    return {
      month,
      usedTokens: document?.usedTokens ?? 0,
      reservedTokens: document?.reservedTokens ?? 0,
      limit,
    };
  }

  async reserveTokens(
    context: TrustedTenantContext,
    month: string,
    limit: number,
    amount: number,
  ): Promise<boolean> {
    const collection = await this.collection<UsageMonthDocument>(context, MONTHLY_USAGE);
    const now = new Date().toISOString();
    try {
      await collection.updateOne(
        { _tenantId: context.tenantId, month },
        {
          $setOnInsert: {
            _id: randomUUID(),
            _tenantId: context.tenantId,
            month,
            usedTokens: 0,
            reservedTokens: 0,
            updatedAt: now,
          },
        },
        { upsert: true },
      );
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
    }
    const result = await collection.updateOne(
      {
        _tenantId: context.tenantId,
        month,
        $expr: {
          $lte: [
            {
              $add: [{ $ifNull: ['$usedTokens', 0] }, { $ifNull: ['$reservedTokens', 0] }, amount],
            },
            limit,
          ],
        },
      },
      { $inc: { reservedTokens: amount }, $set: { updatedAt: now } },
    );
    return result.modifiedCount === 1;
  }

  async settleTokens(
    context: TrustedTenantContext,
    month: string,
    reserved: number,
    actual: number,
  ): Promise<void> {
    const result = await (
      await this.collection<UsageMonthDocument>(context, MONTHLY_USAGE)
    ).updateOne(
      {
        _tenantId: context.tenantId,
        month,
        reservedTokens: { $gte: reserved },
      },
      {
        $inc: { reservedTokens: -reserved, usedTokens: actual },
        $set: { updatedAt: new Date().toISOString() },
      },
    );
    if (result.modifiedCount !== 1) throw new TenantStorageUnavailableError();
  }

  async recordUsage(
    context: TrustedTenantContext,
    record: Omit<AiUsageRecord, 'tenantId'>,
  ): Promise<void> {
    const document: UsageDocument = {
      _id: record.id,
      _tenantId: context.tenantId,
      agentId: record.agentId,
      provider: record.provider,
      model: record.model,
      inputTokenEstimate: record.inputTokenEstimate,
      outputTokenEstimate: record.outputTokenEstimate,
      status: record.status,
      occurredAt: record.occurredAt,
    };
    await (await this.collection<UsageDocument>(context, USAGE)).insertOne(document);
  }

  async listUsage(context: TrustedTenantContext, limit: number): Promise<AiUsageRecord[]> {
    const documents = await (
      await this.collection<UsageDocument>(context, USAGE)
    )
      .find({ _tenantId: context.tenantId })
      .sort({ occurredAt: -1, _id: -1 })
      .limit(limit)
      .toArray();
    return documents.map((document) => usageFromDocument(context.tenantId, document));
  }

  async recordAudit(
    context: TrustedTenantContext,
    record: Omit<AiAuditRecord, 'tenantId'>,
  ): Promise<void> {
    const document: AuditDocument = {
      _id: record.id,
      _tenantId: context.tenantId,
      actorUserId: record.actorUserId,
      action: record.action,
      targetId: record.targetId,
      ...(record.provider ? { provider: record.provider } : {}),
      ...(record.model ? { model: record.model } : {}),
      ...(record.tokenEstimate !== undefined ? { tokenEstimate: record.tokenEstimate } : {}),
      occurredAt: record.occurredAt,
    };
    await (await this.collection<AuditDocument>(context, AUDIT)).insertOne(document);
  }

  async listAudit(context: TrustedTenantContext, limit: number): Promise<AiAuditRecord[]> {
    const documents = await (
      await this.collection<AuditDocument>(context, AUDIT)
    )
      .find({ _tenantId: context.tenantId })
      .sort({ occurredAt: -1, _id: -1 })
      .limit(limit)
      .toArray();
    return documents.map((document) => ({
      id: document._id,
      tenantId: context.tenantId,
      actorUserId: document.actorUserId,
      action: document.action,
      targetId: document.targetId,
      ...(document.provider ? { provider: document.provider } : {}),
      ...(document.model ? { model: document.model } : {}),
      ...(document.tokenEstimate !== undefined ? { tokenEstimate: document.tokenEstimate } : {}),
      occurredAt: document.occurredAt,
    }));
  }

  private async collection<T extends ScopedDocument>(
    context: TrustedTenantContext,
    name: string,
  ): Promise<Collection<T>> {
    if (!context || !isWellFormedTrustedTenantContext(context)) {
      throw new TenantContextInvalidError();
    }
    const route = await this.routes.resolve(context);
    const target = await this.resolveTarget(context, route);
    const collection = (await this.clients.getDatabase(target)).collection<T>(name);
    await ensureIndexes(collection, name);
    return collection;
  }

  private async resolveTarget(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
  ): Promise<TenantStorageTargetRecord> {
    if (!route || !Array.isArray(route.placements) || route.placements.length === 0) {
      throw new TenantStorageNotConfiguredError();
    }
    if (route.placements.length !== 1) throw new TenantStorageUnavailableError();
    const placement = route.placements[0];
    if (!placement) throw new TenantStorageNotConfiguredError();
    const target = await this.targets.findActivePrimaryTarget(context, placement.placementId);
    if (!target || target.tenantId.toLowerCase() !== context.tenantId.toLowerCase()) {
      throw new TenantStorageNotConfiguredError();
    }
    return target;
  }
}

@Injectable()
export class InMemoryAiTenantStore implements AiTenantStore {
  private readonly agents = new Map<string, Map<string, AiAgent>>();
  private readonly knowledge = new Map<string, Map<string, AiKnowledgeSource>>();
  private readonly budgets = new Map<string, AiBudget>();
  private readonly usage = new Map<string, AiUsageRecord[]>();
  private readonly audit = new Map<string, AiAuditRecord[]>();
  private readonly months = new Map<string, { usedTokens: number; reservedTokens: number }>();

  async listAgents(context: TrustedTenantContext): Promise<AiAgent[]> {
    return [...this.partition(this.agents, context).values()].map(cloneAgent);
  }
  async findAgent(context: TrustedTenantContext, id: string): Promise<AiAgent | null> {
    const value = this.partition(this.agents, context).get(id);
    return value ? cloneAgent(value) : null;
  }
  async saveAgent(
    context: TrustedTenantContext,
    input: Omit<AiAgent, 'tenantId' | 'createdAt' | 'updatedAt'>,
  ): Promise<AiAgent> {
    const agents = this.partition(this.agents, context);
    const old = agents.get(input.id);
    const now = new Date().toISOString();
    const value: AiAgent = {
      ...input,
      tenantId: context.tenantId,
      allowedTools: [...input.allowedTools],
      createdAt: old?.createdAt ?? now,
      updatedAt: now,
    };
    agents.set(value.id, value);
    return cloneAgent(value);
  }
  async listKnowledge(context: TrustedTenantContext): Promise<AiKnowledgeSource[]> {
    return [...this.partition(this.knowledge, context).values()].map(cloneKnowledge);
  }
  async createKnowledge(
    context: TrustedTenantContext,
    input: Omit<AiKnowledgeSource, 'tenantId' | 'createdAt' | 'updatedAt'>,
  ): Promise<AiKnowledgeSource> {
    const now = new Date().toISOString();
    const value: AiKnowledgeSource = {
      ...input,
      tenantId: context.tenantId,
      createdAt: now,
      updatedAt: now,
    };
    this.partition(this.knowledge, context).set(value.id, value);
    return cloneKnowledge(value);
  }
  async deleteKnowledge(context: TrustedTenantContext, id: string): Promise<boolean> {
    return this.partition(this.knowledge, context).delete(id);
  }
  async searchKnowledge(
    context: TrustedTenantContext,
    query: string,
    limit: number,
  ): Promise<AiKnowledgeSource[]> {
    const terms = tokenize(query);
    return [...this.partition(this.knowledge, context).values()]
      .filter((source) => source.status === 'ACTIVE')
      .map((source) => ({
        source,
        score: lexicalScore(terms, `${source.title} ${source.content}`),
      }))
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
      .map(({ source }) => cloneKnowledge(source));
  }
  async getBudget(context: TrustedTenantContext): Promise<AiBudget> {
    return (
      this.budgets.get(this.key(context)) ?? {
        tenantId: context.tenantId,
        monthlyTokenLimit: null,
        maxInputTokens: 2048,
        maxOutputTokens: 512,
        updatedAt: new Date(0).toISOString(),
      }
    );
  }
  async saveBudget(
    context: TrustedTenantContext,
    input: Pick<AiBudget, 'monthlyTokenLimit' | 'maxInputTokens' | 'maxOutputTokens'>,
  ): Promise<AiBudget> {
    const budget = { ...input, tenantId: context.tenantId, updatedAt: new Date().toISOString() };
    this.budgets.set(this.key(context), budget);
    return { ...budget };
  }
  async getMonthlyUsage(
    context: TrustedTenantContext,
    month: string,
    limit: number,
  ): Promise<AiMonthlyUsage> {
    const usage = this.months.get(`${this.key(context)}:${month}`);
    return {
      month,
      usedTokens: usage?.usedTokens ?? 0,
      reservedTokens: usage?.reservedTokens ?? 0,
      limit,
    };
  }
  async reserveTokens(
    context: TrustedTenantContext,
    month: string,
    limit: number,
    amount: number,
  ): Promise<boolean> {
    const key = `${this.key(context)}:${month}`;
    const usage = this.months.get(key) ?? { usedTokens: 0, reservedTokens: 0 };
    if (usage.usedTokens + usage.reservedTokens + amount > limit) return false;
    usage.reservedTokens += amount;
    this.months.set(key, usage);
    return true;
  }
  async settleTokens(
    context: TrustedTenantContext,
    month: string,
    reserved: number,
    actual: number,
  ): Promise<void> {
    const usage = this.months.get(`${this.key(context)}:${month}`);
    if (!usage || usage.reservedTokens < reserved) throw new TenantStorageUnavailableError();
    usage.reservedTokens -= reserved;
    usage.usedTokens += actual;
  }
  async recordUsage(
    context: TrustedTenantContext,
    record: Omit<AiUsageRecord, 'tenantId'>,
  ): Promise<void> {
    const key = this.key(context);
    const rows = this.usage.get(key) ?? [];
    rows.push({ ...record, tenantId: context.tenantId });
    this.usage.set(key, rows);
  }
  async listUsage(context: TrustedTenantContext, limit: number): Promise<AiUsageRecord[]> {
    return (this.usage.get(this.key(context)) ?? [])
      .slice()
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      .slice(0, limit)
      .map((record) => ({ ...record }));
  }
  async recordAudit(
    context: TrustedTenantContext,
    record: Omit<AiAuditRecord, 'tenantId'>,
  ): Promise<void> {
    const key = this.key(context);
    const rows = this.audit.get(key) ?? [];
    rows.push({ ...record, tenantId: context.tenantId });
    this.audit.set(key, rows);
  }
  async listAudit(context: TrustedTenantContext, limit: number): Promise<AiAuditRecord[]> {
    return (this.audit.get(this.key(context)) ?? [])
      .slice()
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      .slice(0, limit)
      .map((record) => ({ ...record }));
  }

  private partition<T>(
    store: Map<string, Map<string, T>>,
    context: TrustedTenantContext,
  ): Map<string, T> {
    this.assertContext(context);
    let partition = store.get(context.tenantId);
    if (!partition) {
      partition = new Map<string, T>();
      store.set(context.tenantId, partition);
    }
    return partition;
  }
  private key(context: TrustedTenantContext): string {
    this.assertContext(context);
    return context.tenantId;
  }
  private assertContext(context: TrustedTenantContext): void {
    if (!context || !isWellFormedTrustedTenantContext(context))
      throw new TenantContextInvalidError();
  }
}

@Injectable()
export class UnconfiguredAiTenantStore implements AiTenantStore {
  private unavailable(): never {
    throw new TenantStorageNotConfiguredError();
  }
  listAgents(): Promise<AiAgent[]> {
    return Promise.reject(this.unavailable());
  }
  findAgent(): Promise<AiAgent | null> {
    return Promise.reject(this.unavailable());
  }
  saveAgent(): Promise<AiAgent> {
    return Promise.reject(this.unavailable());
  }
  listKnowledge(): Promise<AiKnowledgeSource[]> {
    return Promise.reject(this.unavailable());
  }
  createKnowledge(): Promise<AiKnowledgeSource> {
    return Promise.reject(this.unavailable());
  }
  deleteKnowledge(): Promise<boolean> {
    return Promise.reject(this.unavailable());
  }
  searchKnowledge(): Promise<AiKnowledgeSource[]> {
    return Promise.reject(this.unavailable());
  }
  getBudget(): Promise<AiBudget> {
    return Promise.reject(this.unavailable());
  }
  saveBudget(): Promise<AiBudget> {
    return Promise.reject(this.unavailable());
  }
  getMonthlyUsage(): Promise<AiMonthlyUsage> {
    return Promise.reject(this.unavailable());
  }
  reserveTokens(): Promise<boolean> {
    return Promise.reject(this.unavailable());
  }
  settleTokens(): Promise<void> {
    return Promise.reject(this.unavailable());
  }
  recordUsage(): Promise<void> {
    return Promise.reject(this.unavailable());
  }
  listUsage(): Promise<AiUsageRecord[]> {
    return Promise.reject(this.unavailable());
  }
  recordAudit(): Promise<void> {
    return Promise.reject(this.unavailable());
  }
  listAudit(): Promise<AiAuditRecord[]> {
    return Promise.reject(this.unavailable());
  }
}

async function ensureIndexes<T extends ScopedDocument>(
  collection: Collection<T>,
  name: string,
): Promise<void> {
  await collection.createIndex(
    { _tenantId: 1, _id: 1 },
    { name: `${name}_tenant_id_unique`, unique: true },
  );
  if (name === AGENTS) {
    await collection.createIndex(
      { _tenantId: 1, name: 1 },
      { name: 'ai_agents_tenant_name_unique', unique: true },
    );
  } else if (name === KNOWLEDGE) {
    await collection.createIndex(
      { _tenantId: 1, status: 1, updatedAt: -1 },
      { name: 'ai_knowledge_tenant_status_updated' },
    );
  } else if (name === MONTHLY_USAGE) {
    await collection.createIndex(
      { _tenantId: 1, month: 1 },
      { name: 'ai_monthly_usage_tenant_month_unique', unique: true },
    );
  } else if (name === USAGE) {
    await collection.createIndex(
      { _tenantId: 1, occurredAt: -1 },
      { name: 'ai_usage_tenant_occurred' },
    );
  } else if (name === AUDIT) {
    await collection.createIndex(
      { _tenantId: 1, occurredAt: -1 },
      { name: 'ai_audit_tenant_occurred' },
    );
  }
}

function agentFromDocument(tenantId: string, value: AgentDocument): AiAgent {
  return {
    id: value._id,
    tenantId,
    name: value.name,
    description: value.description,
    instructions: value.instructions,
    provider: value.provider,
    model: value.model,
    status: value.status,
    allowedTools: [...value.allowedTools],
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}
function knowledgeFromDocument(tenantId: string, value: KnowledgeDocument): AiKnowledgeSource {
  return {
    id: value._id,
    tenantId,
    title: value.title,
    kind: value.kind,
    content: value.content,
    status: value.status,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}
function budgetFromDocument(tenantId: string, value: BudgetDocument): AiBudget {
  return {
    tenantId,
    monthlyTokenLimit: value.monthlyTokenLimit,
    maxInputTokens: value.maxInputTokens,
    maxOutputTokens: value.maxOutputTokens,
    updatedAt: value.updatedAt,
  };
}
function usageFromDocument(tenantId: string, value: UsageDocument): AiUsageRecord {
  return {
    id: value._id,
    tenantId,
    agentId: value.agentId,
    provider: value.provider,
    model: value.model,
    inputTokenEstimate: value.inputTokenEstimate,
    outputTokenEstimate: value.outputTokenEstimate,
    status: value.status,
    occurredAt: value.occurredAt,
  };
}
function cloneAgent(agent: AiAgent): AiAgent {
  return { ...agent, allowedTools: [...agent.allowedTools] };
}
function cloneKnowledge(source: AiKnowledgeSource): AiKnowledgeSource {
  return { ...source };
}
function tokenize(value: string): string[] {
  return value.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];
}
function lexicalScore(terms: readonly string[], text: string): number {
  if (terms.length === 0) return 0;
  const document = new Set(tokenize(text));
  return terms.reduce((score, term) => score + (document.has(term) ? 1 : 0), 0);
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 11000
  );
}
