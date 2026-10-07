import { ServiceUnavailableException } from '@nestjs/common';

export class TenantStorageNotConfiguredError extends ServiceUnavailableException {
  constructor() {
    super({
      code: 'TENANT_STORAGE_NOT_CONFIGURED',
      message: 'Tenant storage is not configured',
    });
  }
}

export class TenantStorageUnavailableError extends ServiceUnavailableException {
  constructor() {
    super({
      code: 'TENANT_STORAGE_UNAVAILABLE',
      message: 'Tenant storage is currently unavailable',
    });
  }
}
