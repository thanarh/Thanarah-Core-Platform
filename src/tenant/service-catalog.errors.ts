import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

export class ServiceInputValidationError extends BadRequestException {
  constructor() {
    super({ code: 'SERVICE_INPUT_INVALID', message: 'Service details are invalid' });
  }
}

export class ServiceIdInvalidError extends BadRequestException {
  constructor() {
    super({ code: 'SERVICE_ID_INVALID', message: 'Service identifier is invalid' });
  }
}

export class ServiceNotFoundError extends NotFoundException {
  constructor() {
    super({ code: 'SERVICE_NOT_FOUND', message: 'Service was not found in the trusted tenant' });
  }
}

export class ServiceNameConflictError extends ConflictException {
  constructor() {
    super({
      code: 'SERVICE_NAME_CONFLICT',
      message: 'A service with that name already exists in the tenant',
    });
  }
}

export class ServiceCodeConflictError extends ConflictException {
  constructor() {
    super({
      code: 'SERVICE_CODE_CONFLICT',
      message: 'A service with that code already exists in the tenant',
    });
  }
}

export class ServiceConflictError extends ConflictException {
  constructor() {
    super({
      code: 'SERVICE_CONFLICT',
      message: 'A service with conflicting details already exists in the tenant',
    });
  }
}

export class ServiceLifecycleConflictError extends ConflictException {
  constructor() {
    super({
      code: 'SERVICE_STATUS_TRANSITION_INVALID',
      message: 'The requested Service status transition is not allowed',
    });
  }
}
