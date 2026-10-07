import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

export class DoctorInputValidationError extends BadRequestException {
  constructor() {
    super({ code: 'DOCTOR_INPUT_INVALID', message: 'Doctor profile details are invalid' });
  }
}

export class DoctorIdInvalidError extends BadRequestException {
  constructor() {
    super({ code: 'DOCTOR_ID_INVALID', message: 'Doctor identifier is invalid' });
  }
}

export class DoctorNotFoundError extends NotFoundException {
  constructor() {
    super({ code: 'DOCTOR_NOT_FOUND', message: 'Doctor was not found in the trusted tenant' });
  }
}

export class DoctorStaffNotFoundError extends NotFoundException {
  constructor() {
    super({
      code: 'DOCTOR_STAFF_NOT_FOUND',
      message: 'An eligible Staff profile was not found in the trusted tenant',
    });
  }
}

export class DoctorStaffIneligibleError extends ConflictException {
  constructor() {
    super({
      code: 'DOCTOR_STAFF_INELIGIBLE',
      message: 'Doctor creation requires active Staff with a valid active membership',
    });
  }
}

export class DoctorAlreadyExistsError extends ConflictException {
  constructor() {
    super({
      code: 'DOCTOR_ALREADY_EXISTS',
      message: 'This Staff profile already has a Doctor profile in the tenant',
    });
  }
}

export class DoctorProfessionalCodeConflictError extends ConflictException {
  constructor() {
    super({
      code: 'DOCTOR_PROFESSIONAL_CODE_EXISTS',
      message: 'This professional code is already in use in the tenant',
    });
  }
}

export class DoctorTenantUnavailableError extends ConflictException {
  constructor() {
    super({
      code: 'DOCTOR_TENANT_UNAVAILABLE',
      message: 'Doctor profile changes require an active tenant',
    });
  }
}

export class DoctorLifecycleConflictError extends ConflictException {
  constructor() {
    super({
      code: 'DOCTOR_STATUS_TRANSITION_INVALID',
      message: 'The requested Doctor lifecycle transition is not allowed',
    });
  }
}

export class DoctorAssignmentTargetNotFoundError extends NotFoundException {
  constructor(target: 'department' | 'specialty' | 'catalog') {
    const label = target === 'catalog' ? 'Department or Specialty' : target;
    super({
      code: `DOCTOR_${target.toUpperCase()}_NOT_FOUND`,
      message: `An active ${label} was not found in the trusted tenant`,
    });
  }
}

export class DoctorAssignmentConflictError extends ConflictException {
  constructor(target: 'department' | 'specialty') {
    super({
      code: `DOCTOR_${target.toUpperCase()}_ASSIGNMENT_EXISTS`,
      message: `The ${target} is already assigned to this Doctor`,
    });
  }
}

export class DoctorAssignmentNotFoundError extends NotFoundException {
  constructor(target: 'department' | 'specialty') {
    super({
      code: `DOCTOR_${target.toUpperCase()}_ASSIGNMENT_NOT_FOUND`,
      message: `The ${target} assignment was not found for this Doctor`,
    });
  }
}
