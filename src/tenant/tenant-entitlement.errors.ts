import { ForbiddenException } from '@nestjs/common';

export class TenantFeatureNotIncludedError extends ForbiddenException {
  constructor() {
    super({
      code: 'FEATURE_NOT_INCLUDED',
      message: 'The required feature is not available',
    });
  }
}

export class TenantFeatureRequirementMissingError extends ForbiddenException {
  constructor() {
    super({
      code: 'TENANT_FEATURE_REQUIREMENT_MISSING',
      message: 'Tenant feature entitlement is not configured for this route',
    });
  }
}
