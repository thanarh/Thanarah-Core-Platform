import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

export class CommunicationRetentionPolicyRequiredError extends ConflictException {
  constructor() {
    super({
      code: 'COMMUNICATION_RETENTION_POLICY_REQUIRED',
      message: 'Configure tenant communication retention before processing events',
    });
  }
}

export class CommunicationSyntheticInputRequiredError extends BadRequestException {
  constructor() {
    super({
      code: 'COMMUNICATION_SYNTHETIC_INPUT_REQUIRED',
      message: 'Communication simulation accepts synthetic subject references only',
    });
  }
}

export class CommunicationRetentionPolicyInvalidError extends BadRequestException {
  constructor() {
    super({
      code: 'COMMUNICATION_RETENTION_POLICY_INVALID',
      message: 'The configured retention period cannot be represented safely',
    });
  }
}

export class CommunicationProviderUnavailableError extends ServiceUnavailableException {
  constructor() {
    super({
      code: 'COMMUNICATION_PROVIDER_UNAVAILABLE',
      message: 'Live communication providers are not configured or approved',
    });
  }
}

export class CommunicationWebhookRejectedError extends UnauthorizedException {
  constructor() {
    super({
      code: 'COMMUNICATION_WEBHOOK_REJECTED',
      message: 'The communication webhook could not be authenticated',
    });
  }
}
