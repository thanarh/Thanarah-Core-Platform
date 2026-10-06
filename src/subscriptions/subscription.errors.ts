import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';

export class SubscriptionInputInvalidError extends BadRequestException {
  constructor() {
    super({
      code: 'SUBSCRIPTION_INPUT_INVALID',
      message: 'Subscription details are invalid',
    });
  }
}

export class SubscriptionIdInvalidError extends BadRequestException {
  constructor() {
    super({
      code: 'SUBSCRIPTION_ID_INVALID',
      message: 'Subscription identifier is invalid',
    });
  }
}

export class SubscriptionNotFoundError extends NotFoundException {
  constructor() {
    super({ code: 'SUBSCRIPTION_NOT_FOUND', message: 'Subscription was not found' });
  }
}

export class SubscriptionTenantNotFoundError extends NotFoundException {
  constructor() {
    super({ code: 'SUBSCRIPTION_TENANT_NOT_FOUND', message: 'Tenant was not found' });
  }
}

export class SubscriptionPlanNotFoundError extends NotFoundException {
  constructor() {
    super({ code: 'SUBSCRIPTION_PLAN_NOT_FOUND', message: 'Plan was not found' });
  }
}

export class SubscriptionTenantUnavailableError extends ConflictException {
  constructor() {
    super({
      code: 'SUBSCRIPTION_TENANT_UNAVAILABLE',
      message: 'Tenant cannot receive or activate a Subscription in its current state',
    });
  }
}

export class SubscriptionPlanUnavailableError extends ConflictException {
  constructor() {
    super({
      code: 'SUBSCRIPTION_PLAN_UNAVAILABLE',
      message: 'Only an active Plan can receive a new Subscription',
    });
  }
}

export class SubscriptionCurrentConflictError extends ConflictException {
  constructor() {
    super({
      code: 'SUBSCRIPTION_PERIOD_CONFLICT',
      message: 'The Subscription period overlaps another active period for this Tenant',
    });
  }
}

export class SubscriptionLifecycleConflictError extends ConflictException {
  constructor() {
    super({
      code: 'SUBSCRIPTION_STATUS_TRANSITION_INVALID',
      message: 'The requested Subscription lifecycle operation is not allowed',
    });
  }
}

export class SubscriptionInvariantViolationError extends InternalServerErrorException {
  constructor() {
    super({
      code: 'SUBSCRIPTION_CURRENT_INVARIANT_VIOLATED',
      message: 'Current Subscription state is unavailable',
    });
  }
}
