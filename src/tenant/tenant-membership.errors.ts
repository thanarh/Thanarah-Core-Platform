import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

export class TenantMembershipInputValidationError extends BadRequestException {
  constructor() {
    super({
      code: 'TENANT_MEMBERSHIP_INPUT_INVALID',
      message: 'Tenant membership input is invalid',
    });
  }
}

export class TenantMembershipNotFoundError extends NotFoundException {
  constructor() {
    super({
      code: 'TENANT_MEMBERSHIP_NOT_FOUND',
      message: 'Tenant membership was not found',
    });
  }
}

export class TenantMembershipPlatformUserNotFoundError extends NotFoundException {
  constructor() {
    super({
      code: 'TENANT_MEMBERSHIP_PLATFORM_USER_NOT_FOUND',
      message: 'Platform user was not found',
    });
  }
}

export class TenantMembershipExistsError extends ConflictException {
  constructor() {
    super({
      code: 'TENANT_MEMBERSHIP_EXISTS',
      message: 'A membership already exists for this tenant and platform user',
    });
  }
}

export class TenantMembershipLifecycleConflictError extends ConflictException {
  constructor() {
    super({
      code: 'TENANT_MEMBERSHIP_TRANSITION_INVALID',
      message: 'The requested tenant membership transition is not allowed',
    });
  }
}

export class TenantMembershipSelfManagementError extends ForbiddenException {
  constructor() {
    super({
      code: 'TENANT_MEMBERSHIP_SELF_MANAGEMENT_FORBIDDEN',
      message: 'Platform administrators cannot manage their own tenant membership',
    });
  }
}
