import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

export class TenantStaffScopeInputValidationError extends BadRequestException {
  constructor() {
    super({
      code: 'TENANT_STAFF_SCOPE_INPUT_INVALID',
      message: 'The staff scope request is invalid',
    });
  }
}

export class TenantStaffScopeConflictError extends ConflictException {
  constructor() {
    super({
      code: 'TENANT_STAFF_SCOPE_ASSIGNMENT_CONFLICT',
      message: 'Staff and organizational units must be active and the assignment must be unique',
    });
  }
}

export class TenantStaffScopeNotFoundError extends NotFoundException {
  constructor() {
    super({
      code: 'TENANT_STAFF_SCOPE_NOT_FOUND',
      message: 'The staff profile, organizational unit, or assignment was not found',
    });
  }
}
