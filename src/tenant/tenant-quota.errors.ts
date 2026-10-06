import { BadRequestException, ConflictException } from '@nestjs/common';

export class TenantQuotaInputInvalidError extends BadRequestException {
  constructor() {
    super({ code: 'TENANT_QUOTA_INPUT_INVALID', message: 'Quota check input is invalid' });
  }
}

export class TenantQuotaExceededError extends ConflictException {
  constructor() {
    super({
      code: 'QUOTA_EXCEEDED',
      message: 'The requested operation exceeds an available limit',
    });
  }
}
