import { randomUUID } from 'node:crypto';
import { fork, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { AiProviderUnavailableError } from './ai-platform.errors';
import type { AiInferenceResult, AiInferenceRuntime, AiProviderId } from './ai-platform.types';

interface RuntimeReply {
  id?: string;
  type?: string;
  ok?: boolean;
  result?: AiInferenceResult;
  errorCode?: string;
}

interface PendingRequest {
  resolve: (result: AiInferenceResult) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

@Injectable()
export class AiRuntimeClient implements AiInferenceRuntime, OnApplicationShutdown {
  private process?: ChildProcess;
  private ready?: Promise<void>;
  private readonly pending = new Map<string, PendingRequest>();

  constructor(private readonly config: ConfigService) {}

  async generate(input: {
    provider: AiProviderId;
    model: string;
    instructions: string;
    prompt: string;
    maxOutputTokens: number;
  }): Promise<AiInferenceResult> {
    const apiKey = input.provider === 'openai-compatible' ? this.config.aiOpenAiApiKey : undefined;
    if (
      input.provider === 'openai-compatible' &&
      (!this.config.aiExternalInferenceEnabled || !apiKey)
    ) {
      throw new AiProviderUnavailableError();
    }
    if (input.provider === 'ollama' && !this.config.aiOllamaEnabled) {
      throw new AiProviderUnavailableError();
    }

    await this.ensureRuntime();
    const worker = this.process;
    if (!worker || !worker.connected) throw new AiProviderUnavailableError();
    const id = randomUUID();
    return new Promise<AiInferenceResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new AiProviderUnavailableError());
      }, 35_000);
      this.pending.set(id, { resolve, reject, timer });
      worker.send(
        {
          id,
          type: 'generate',
          input: {
            ...input,
            ...(apiKey ? { apiKey } : {}),
            ...(input.provider === 'openai-compatible'
              ? { baseUrl: this.config.aiOpenAiBaseUrl }
              : {}),
          },
        },
        (error) => {
          if (!error) return;
          const pending = this.pending.get(id);
          if (!pending) return;
          clearTimeout(pending.timer);
          this.pending.delete(id);
          pending.reject(new AiProviderUnavailableError());
        },
      );
    });
  }

  async onApplicationShutdown(): Promise<void> {
    const child = this.process;
    this.process = undefined;
    this.ready = undefined;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new AiProviderUnavailableError());
    }
    this.pending.clear();
    if (!child || child.exitCode !== null) return;
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 1500);
      child.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  private async ensureRuntime(): Promise<void> {
    if (!this.ready) {
      this.ready = new Promise<void>((resolve, reject) => {
        const child = fork(join(__dirname, 'ai-runtime-worker.js'), [], {
          cwd: process.cwd(),
          env: {
            NODE_ENV: this.config.nodeEnv,
            AI_EXTERNAL_INFERENCE_ENABLED: String(this.config.aiExternalInferenceEnabled),
            AI_OLLAMA_ENABLED: String(this.config.aiOllamaEnabled),
          },
          execArgv: [],
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
          serialization: 'json',
        });
        this.process = child;
        const startupTimeout = setTimeout(() => {
          this.ready = undefined;
          reject(new AiProviderUnavailableError());
          child.kill('SIGKILL');
        }, 5000);
        child.on('message', (message: RuntimeReply) => {
          if (message?.type === 'ready') {
            clearTimeout(startupTimeout);
            resolve();
            return;
          }
          if (!message || typeof message.id !== 'string') return;
          const pending = this.pending.get(message.id);
          if (!pending) return;
          clearTimeout(pending.timer);
          this.pending.delete(message.id);
          if (message.ok && message.result && typeof message.result.text === 'string') {
            pending.resolve(message.result);
          } else {
            pending.reject(new AiProviderUnavailableError());
          }
        });
        child.once('error', () => {
          clearTimeout(startupTimeout);
          this.failPending();
          this.ready = undefined;
          reject(new AiProviderUnavailableError());
        });
        child.once('exit', () => {
          clearTimeout(startupTimeout);
          this.failPending();
          this.process = undefined;
          this.ready = undefined;
        });
      });
    }
    await this.ready;
  }

  private failPending(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new AiProviderUnavailableError());
    }
    this.pending.clear();
  }
}
