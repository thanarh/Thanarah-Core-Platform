import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';

export class AiPlatformInputError extends BadRequestException {
  constructor() {
    super({ code: 'AI_PLATFORM_INPUT_INVALID', message: 'AI platform input is invalid' });
  }
}

export class AiAgentNotFoundError extends NotFoundException {
  constructor() {
    super({ code: 'AI_AGENT_NOT_FOUND', message: 'AI agent was not found' });
  }
}

export class AiBudgetExceededError extends ConflictException {
  constructor() {
    super({ code: 'AI_BUDGET_EXCEEDED', message: 'The tenant AI token budget is exhausted' });
  }
}

export class AiProviderUnavailableError extends ServiceUnavailableException {
  constructor() {
    super({
      code: 'AI_PROVIDER_UNAVAILABLE',
      message: 'The selected AI provider is not enabled or is unavailable',
    });
  }
}

export class AiBudgetNotConfiguredError extends ConflictException {
  constructor() {
    super({
      code: 'AI_BUDGET_NOT_CONFIGURED',
      message: 'The tenant AI token budget is not configured',
    });
  }
}

export class AiInputLimitExceededError extends PayloadTooLargeException {
  constructor() {
    super({
      code: 'AI_INPUT_LIMIT_EXCEEDED',
      message: 'The AI request exceeds the configured input limit',
    });
  }
}

export class AiSyntheticInputRequiredError extends ForbiddenException {
  constructor() {
    super({
      code: 'AI_SYNTHETIC_INPUT_REQUIRED',
      message: 'Only synthetic test prompts are accepted by this AI workspace',
    });
  }
}

export class AiKnowledgeSafetyError extends ForbiddenException {
  constructor() {
    super({
      code: 'AI_KNOWLEDGE_CONTENT_RESTRICTED',
      message: 'Knowledge sources must not contain patient or personal information',
    });
  }
}

export class AiPersonalDataBlockedError extends ForbiddenException {
  constructor() {
    super({
      code: 'AI_PERSONAL_DATA_BLOCKED',
      message: 'AI test inputs and configuration must not include patient or personal information',
    });
  }
}
