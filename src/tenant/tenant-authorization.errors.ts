import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

export class TenantPermissionDeniedError extends ForbiddenException {
  constructor() {
    super({
      code: 'TENANT_PERMISSION_DENIED',
      message: 'The active tenant membership does not have the required permission',
    });
  }
}

export class TenantPermissionRequirementMissingError extends ForbiddenException {
  constructor() {
    super({
      code: 'TENANT_PERMISSION_REQUIREMENT_MISSING',
      message: 'Tenant authorization is not configured for this route',
    });
  }
}

export class TenantRoleInputValidationError extends BadRequestException {
  constructor() {
    super({
      code: 'TENANT_ROLE_INPUT_INVALID',
      message: 'Tenant role input is invalid',
    });
  }
}

export class TenantRoleNotFoundError extends NotFoundException {
  constructor() {
    super({
      code: 'TENANT_ROLE_NOT_FOUND',
      message: 'Tenant role was not found',
    });
  }
}

export class TenantRoleCodeConflictError extends ConflictException {
  constructor() {
    super({
      code: 'TENANT_ROLE_CODE_CONFLICT',
      message: 'A tenant role with this code already exists',
    });
  }
}

export class TenantSystemRoleProtectedError extends ConflictException {
  constructor() {
    super({
      code: 'TENANT_SYSTEM_ROLE_PROTECTED',
      message: 'Default tenant roles cannot be changed through role administration',
    });
  }
}

export class TenantPermissionCatalogUnavailableError extends ServiceUnavailableException {
  constructor() {
    super({
      code: 'TENANT_PERMISSION_CATALOG_UNAVAILABLE',
      message: 'The tenant permission catalog is not available',
    });
  }
}

export class TenantPermissionAssignmentInvalidError extends BadRequestException {
  constructor() {
    super({
      code: 'TENANT_PERMISSION_ASSIGNMENT_INVALID',
      message: 'One or more tenant permissions cannot be assigned to this role',
    });
  }
}

export class TenantMembershipRoleTargetNotFoundError extends NotFoundException {
  constructor() {
    super({
      code: 'TENANT_MEMBERSHIP_ROLE_TARGET_NOT_FOUND',
      message: 'The active tenant membership or tenant role was not found',
    });
  }
}

export class TenantSelfRoleAssignmentError extends ForbiddenException {
  constructor() {
    super({
      code: 'TENANT_SELF_ROLE_ASSIGNMENT_FORBIDDEN',
      message: 'A tenant member cannot change their own role assignments',
    });
  }
}

export class TenantOwnerAssignmentForbiddenError extends ForbiddenException {
  constructor() {
    super({
      code: 'TENANT_OWNER_ASSIGNMENT_FORBIDDEN',
      message: 'Only an existing tenant owner or a platform administrator can assign ownership',
    });
  }
}

export class TenantOwnerBootstrapConflictError extends ConflictException {
  constructor() {
    super({
      code: 'TENANT_OWNER_BOOTSTRAP_CONFLICT',
      message: 'The tenant owner bootstrap cannot be completed in the current state',
    });
  }
}

export class TenantOwnerProtectionError extends ConflictException {
  constructor() {
    super({
      code: 'TENANT_OWNER_PROTECTED',
      message:
        'Owner assignments cannot be removed or deactivated through ordinary role management',
    });
  }
}
