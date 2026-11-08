import type { TrustedTenantContext } from '../tenant/tenant-context.contract';

export type AiProviderId = 'openai-compatible' | 'ollama';
export type AiAgentStatus = 'ACTIVE' | 'INACTIVE';
export type AiKnowledgeSourceStatus = 'ACTIVE' | 'ARCHIVED';
export type AiKnowledgeSourceKind = 'FAQ' | 'TEXT';
export type AiUsageStatus = 'SUCCEEDED' | 'FAILED' | 'REJECTED';
export type AiToolId = 'knowledge.search';

export interface AiAgent {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  instructions: string;
  provider: AiProviderId;
  model: string;
  status: AiAgentStatus;
  allowedTools: AiToolId[];
  createdAt: string;
  updatedAt: string;
}

export interface AiKnowledgeSource {
  id: string;
  tenantId: string;
  title: string;
  kind: AiKnowledgeSourceKind;
  content: string;
  status: AiKnowledgeSourceStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AiBudget {
  tenantId: string;
  monthlyTokenLimit: number | null;
  maxInputTokens: number;
  maxOutputTokens: number;
  updatedAt: string;
}

export interface AiMonthlyUsage {
  month: string;
  usedTokens: number;
  reservedTokens: number;
  limit: number;
}

export interface AiUsageRecord {
  id: string;
  tenantId: string;
  agentId: string;
  provider: AiProviderId;
  model: string;
  inputTokenEstimate: number;
  outputTokenEstimate: number;
  status: AiUsageStatus;
  occurredAt: string;
}

export interface AiAuditRecord {
  id: string;
  tenantId: string;
  actorUserId: string;
  action:
    | 'AGENT_CREATED'
    | 'AGENT_UPDATED'
    | 'KNOWLEDGE_CREATED'
    | 'KNOWLEDGE_DELETED'
    | 'BUDGET_UPDATED'
    | 'INFERENCE_SUCCEEDED'
    | 'INFERENCE_FAILED'
    | 'INFERENCE_REJECTED';
  targetId: string;
  provider?: AiProviderId;
  model?: string;
  tokenEstimate?: number;
  occurredAt: string;
}

export interface AiProviderStatus {
  id: AiProviderId;
  label: string;
  configured: boolean;
  enabled: boolean;
}

export interface AiInferenceResult {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface AiTenantStore {
  listAgents(context: TrustedTenantContext): Promise<AiAgent[]>;
  findAgent(context: TrustedTenantContext, id: string): Promise<AiAgent | null>;
  saveAgent(
    context: TrustedTenantContext,
    input: Omit<AiAgent, 'tenantId' | 'createdAt' | 'updatedAt'>,
  ): Promise<AiAgent>;
  listKnowledge(context: TrustedTenantContext): Promise<AiKnowledgeSource[]>;
  createKnowledge(
    context: TrustedTenantContext,
    input: Omit<AiKnowledgeSource, 'tenantId' | 'createdAt' | 'updatedAt'>,
  ): Promise<AiKnowledgeSource>;
  deleteKnowledge(context: TrustedTenantContext, id: string): Promise<boolean>;
  searchKnowledge(
    context: TrustedTenantContext,
    query: string,
    limit: number,
  ): Promise<AiKnowledgeSource[]>;
  getBudget(context: TrustedTenantContext): Promise<AiBudget>;
  saveBudget(
    context: TrustedTenantContext,
    input: Pick<AiBudget, 'monthlyTokenLimit' | 'maxInputTokens' | 'maxOutputTokens'>,
  ): Promise<AiBudget>;
  getMonthlyUsage(
    context: TrustedTenantContext,
    month: string,
    limit: number,
  ): Promise<AiMonthlyUsage>;
  reserveTokens(
    context: TrustedTenantContext,
    month: string,
    limit: number,
    amount: number,
  ): Promise<boolean>;
  settleTokens(
    context: TrustedTenantContext,
    month: string,
    reserved: number,
    actual: number,
  ): Promise<void>;
  recordUsage(
    context: TrustedTenantContext,
    record: Omit<AiUsageRecord, 'tenantId'>,
  ): Promise<void>;
  listUsage(context: TrustedTenantContext, limit: number): Promise<AiUsageRecord[]>;
  recordAudit(
    context: TrustedTenantContext,
    record: Omit<AiAuditRecord, 'tenantId'>,
  ): Promise<void>;
  listAudit(context: TrustedTenantContext, limit: number): Promise<AiAuditRecord[]>;
}

export const AI_TENANT_STORE = Symbol('AI_TENANT_STORE');

export interface AiInferenceRuntime {
  generate(input: {
    provider: AiProviderId;
    model: string;
    instructions: string;
    prompt: string;
    maxOutputTokens: number;
  }): Promise<AiInferenceResult>;
}

export const AI_INFERENCE_RUNTIME = Symbol('AI_INFERENCE_RUNTIME');

export interface AiRequestContext {
  requestId?: string;
}
