import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

export class TenantStaffRoleAssignmentInputValidationError extends BadRequestException {
  constructor() {
    super({
      code: 'TENANT_STAFF_ROLE_ASSIGNMENT_INPUT_INVALID',
      message: 'Tenant staff role assignment input is invalid',
    });
  }
}

export class TenantStaffRoleAssignmentNotFoundError extends NotFoundException {
  constructor() {
    super({
      code: 'TENANT_STAFF_ROLE_ASSIGNMENT_NOT_FOUND',
      message: 'Staff profile, tenant role, or role assignment was not found',
    });
  }
}

export class TenantStaffRoleAssignmentConflictError extends ConflictException {
  constructor() {
    super({
      code: 'TENANT_STAFF_ROLE_ASSIGNMENT_CONFLICT',
      message: 'The staff profile and membership must be active to assign a role',
    });
  }
}

export class TenantStaffRoleSelfAssignmentError extends ForbiddenException {
  constructor() {
    super({
      code: 'TENANT_STAFF_ROLE_SELF_ASSIGNMENT_FORBIDDEN',
      message: 'A tenant member cannot assign a role to their own staff profile',
    });
  }
}
