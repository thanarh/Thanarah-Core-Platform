import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

export class PlanInputInvalidError extends BadRequestException {
  constructor() {
    super({ code: 'PLAN_INPUT_INVALID', message: 'Plan details are invalid' });
  }
}

export class FeatureInputInvalidError extends BadRequestException {
  constructor() {
    super({ code: 'FEATURE_INPUT_INVALID', message: 'Feature details are invalid' });
  }
}

export class CatalogIdInvalidError extends BadRequestException {
  constructor(entity: 'Plan' | 'Feature') {
    super({
      code: `${entity.toUpperCase()}_ID_INVALID`,
      message: `${entity} identifier is invalid`,
    });
  }
}

export class PlanNotFoundError extends NotFoundException {
  constructor() {
    super({ code: 'PLAN_NOT_FOUND', message: 'Plan was not found' });
  }
}

export class FeatureNotFoundError extends NotFoundException {
  constructor() {
    super({ code: 'FEATURE_NOT_FOUND', message: 'Feature was not found' });
  }
}

export class PlanKeyConflictError extends ConflictException {
  constructor() {
    super({ code: 'PLAN_KEY_CONFLICT', message: 'Plan key is already in use' });
  }
}

export class FeatureKeyConflictError extends ConflictException {
  constructor() {
    super({ code: 'FEATURE_KEY_CONFLICT', message: 'Feature key is already in use' });
  }
}

export class PlanLifecycleConflictError extends ConflictException {
  constructor() {
    super({
      code: 'PLAN_STATUS_TRANSITION_INVALID',
      message: 'The requested Plan status transition is not allowed',
    });
  }
}

export class FeatureLifecycleConflictError extends ConflictException {
  constructor() {
    super({
      code: 'FEATURE_STATUS_TRANSITION_INVALID',
      message: 'The requested Feature status transition is not allowed',
    });
  }
}

export class PlanFeatureConflictError extends ConflictException {
  constructor(message = 'Feature is already associated with this Plan') {
    super({ code: 'PLAN_FEATURE_CONFLICT', message });
  }
}

export class PlanFeatureNotFoundError extends NotFoundException {
  constructor() {
    super({ code: 'PLAN_FEATURE_NOT_FOUND', message: 'Plan Feature association was not found' });
  }
}
