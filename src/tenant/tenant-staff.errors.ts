import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

export class TenantStaffInputValidationError extends BadRequestException {
  constructor() {
    super({ code: 'TENANT_STAFF_INPUT_INVALID', message: 'Staff profile details are invalid' });
  }
}

export class TenantStaffIdInvalidError extends BadRequestException {
  constructor() {
    super({ code: 'TENANT_STAFF_ID_INVALID', message: 'Staff identifier is invalid' });
  }
}

export class TenantStaffNotFoundError extends NotFoundException {
  constructor() {
    super({
      code: 'TENANT_STAFF_NOT_FOUND',
      message: 'Staff profile was not found in this tenant',
    });
  }
}

export class TenantStaffMembershipNotEligibleError extends NotFoundException {
  constructor() {
    super({
      code: 'TENANT_STAFF_MEMBERSHIP_NOT_ELIGIBLE',
      message: 'An eligible membership was not found in this tenant',
    });
  }
}

export class TenantStaffAlreadyExistsError extends ConflictException {
  constructor() {
    super({
      code: 'TENANT_STAFF_ALREADY_EXISTS',
      message: 'This tenant member already has a staff profile',
    });
  }
}

export class TenantStaffTenantUnavailableError extends ConflictException {
  constructor() {
    super({
      code: 'TENANT_STAFF_TENANT_UNAVAILABLE',
      message: 'Staff operations require an active tenant',
    });
  }
}

export class TenantStaffLifecycleConflictError extends ConflictException {
  constructor() {
    super({
      code: 'TENANT_STAFF_STATUS_TRANSITION_INVALID',
      message: 'The requested staff status transition is not allowed',
    });
  }
}
