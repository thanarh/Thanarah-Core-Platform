import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

export class TenantInputValidationError extends BadRequestException {
  constructor() {
    super({ code: 'TENANT_INPUT_INVALID', message: 'Tenant details are invalid' });
  }
}

export class TenantIdInvalidError extends BadRequestException {
  constructor() {
    super({ code: 'TENANT_ID_INVALID', message: 'Tenant identifier is invalid' });
  }
}

export class TenantNotFoundError extends NotFoundException {
  constructor() {
    super({ code: 'TENANT_NOT_FOUND', message: 'Tenant was not found' });
  }
}

export class TenantSlugConflictError extends ConflictException {
  constructor() {
    super({ code: 'TENANT_SLUG_CONFLICT', message: 'Tenant slug is already in use' });
  }
}

export class TenantLifecycleConflictError extends ConflictException {
  constructor() {
    super({
      code: 'TENANT_STATUS_TRANSITION_INVALID',
      message: 'The requested tenant status transition is not allowed',
    });
  }
}
