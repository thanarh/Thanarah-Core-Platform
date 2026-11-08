import { isIP } from 'node:net';
import type { AiInferenceResult, AiProviderId } from './ai-platform.types';

interface RuntimeMessage {
  id: string;
  type: 'generate';
  input: {
    provider: AiProviderId;
    model: string;
    instructions: string;
    prompt: string;
    maxOutputTokens: number;
    apiKey?: string;
    baseUrl?: string;
  };
}

interface RuntimeReply {
  id: string;
  ok: boolean;
  result?: AiInferenceResult;
  errorCode?: 'AI_PROVIDER_DISABLED' | 'AI_PROVIDER_FAILED';
}

if (typeof process.send === 'function') {
  process.on('message', (message: RuntimeMessage) => {
    void handle(message).then(
      (result) => send({ id: message.id, ok: true, result }),
      (error: unknown) =>
        send({
          id: message.id,
          ok: false,
          errorCode:
            error instanceof ProviderDisabledError ? 'AI_PROVIDER_DISABLED' : 'AI_PROVIDER_FAILED',
        }),
    );
  });
  process.send({ type: 'ready' });
}

async function handle(message: RuntimeMessage): Promise<AiInferenceResult> {
  if (!message || message.type !== 'generate' || !message.input) throw new ProviderDisabledError();
  if (message.input.provider === 'openai-compatible') {
    if (process.env.AI_EXTERNAL_INFERENCE_ENABLED !== 'true' || !message.input.apiKey) {
      throw new ProviderDisabledError();
    }
    return requestOpenAiCompatible(message.input);
  }
  if (message.input.provider === 'ollama') {
    if (process.env.AI_OLLAMA_ENABLED !== 'true') throw new ProviderDisabledError();
    return requestOllama(message.input);
  }
  throw new ProviderDisabledError();
}

async function requestOpenAiCompatible(input: RuntimeMessage['input']): Promise<AiInferenceResult> {
  const baseUrl = validateHostedBaseUrl(input.baseUrl);
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: input.model,
      messages: [
        { role: 'system', content: input.instructions },
        { role: 'user', content: input.prompt },
      ],
      max_tokens: input.maxOutputTokens,
      stream: false,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error('Provider request failed');
  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
  };
  const text = body.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || text.length > 24000) throw new Error('Provider response invalid');
  return {
    text,
    inputTokens: finiteTokenCount(body.usage?.prompt_tokens),
    outputTokens: finiteTokenCount(body.usage?.completion_tokens),
  };
}

async function requestOllama(input: RuntimeMessage['input']): Promise<AiInferenceResult> {
  const response = await fetch('http://127.0.0.1:11434/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: input.model,
      stream: false,
      messages: [
        { role: 'system', content: input.instructions },
        { role: 'user', content: input.prompt },
      ],
      options: { num_predict: input.maxOutputTokens },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error('Provider request failed');
  const body = (await response.json()) as {
    message?: { content?: unknown };
    prompt_eval_count?: unknown;
    eval_count?: unknown;
  };
  const text = body.message?.content;
  if (typeof text !== 'string' || text.length > 24000) throw new Error('Provider response invalid');
  return {
    text,
    inputTokens: finiteTokenCount(body.prompt_eval_count),
    outputTokens: finiteTokenCount(body.eval_count),
  };
}

function validateHostedBaseUrl(value: string | undefined): string {
  let parsed: URL;
  try {
    parsed = new URL(value ?? '');
  } catch {
    throw new ProviderDisabledError();
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== 'https:' ||
    !hostname.includes('.') ||
    isIP(hostname) !== 0 ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new ProviderDisabledError();
  }
  return parsed.toString().replace(/\/+$/u, '');
}

function finiteTokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 1000000
    ? value
    : undefined;
}

function send(reply: RuntimeReply): void {
  if (typeof process.send === 'function') process.send(reply);
}

class ProviderDisabledError extends Error {}
