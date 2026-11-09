import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';

export class SubscriptionPaymentInputError extends BadRequestException {
  constructor() {
    super({
      code: 'SUBSCRIPTION_PAYMENT_INPUT_INVALID',
      message: 'Subscription payment request is invalid',
    });
  }
}

export class SubscriptionPaymentSettingsConflictError extends ConflictException {
  constructor() {
    super({
      code: 'SUBSCRIPTION_PAYMENT_SETTINGS_CONFLICT',
      message: 'Subscription payment settings changed; reload before saving',
    });
  }
}

export class SubscriptionTransferConflictError extends ConflictException {
  constructor() {
    super({
      code: 'SUBSCRIPTION_TRANSFER_STATE_CONFLICT',
      message: 'Subscription transfer is pending, already approved, or was updated',
    });
  }
}

export class SubscriptionTransferNotFoundError extends NotFoundException {
  constructor() {
    super({
      code: 'SUBSCRIPTION_TRANSFER_NOT_FOUND',
      message: 'Subscription transfer was not found',
    });
  }
}

export class SubscriptionTransferPaymentUnavailableError extends UnprocessableEntityException {
  constructor() {
    super({
      code: 'SUBSCRIPTION_TRANSFER_UNAVAILABLE',
      message: 'Bank transfer is not configured for subscription payments',
    });
  }
}

export class SubscriptionPaymentStorageUnavailableError extends ServiceUnavailableException {
  constructor() {
    super({
      code: 'SUBSCRIPTION_PAYMENT_STORAGE_UNAVAILABLE',
      message: 'Subscription payment storage is temporarily unavailable',
    });
  }
}
