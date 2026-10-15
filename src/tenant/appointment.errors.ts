import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

export class AppointmentInputValidationError extends BadRequestException {
  constructor() {
    super({ code: 'APPOINTMENT_INPUT_INVALID', message: 'Appointment input is invalid' });
  }
}

export class AppointmentTimeZoneUnavailableError extends UnprocessableEntityException {
  constructor() {
    super({
      code: 'APPOINTMENT_TIME_ZONE_UNAVAILABLE',
      message: 'An active facility scheduling policy is required for local-date filtering',
    });
  }
}

export class AppointmentIdInvalidError extends BadRequestException {
  constructor() {
    super({ code: 'APPOINTMENT_ID_INVALID', message: 'Appointment ID is invalid' });
  }
}

export class AppointmentNotFoundError extends NotFoundException {
  constructor() {
    super({ code: 'APPOINTMENT_NOT_FOUND', message: 'Appointment not found' });
  }
}

export class AppointmentReferenceInvalidError extends UnprocessableEntityException {
  constructor() {
    super({
      code: 'APPOINTMENT_REFERENCE_INVALID',
      message: 'One or more appointment references are unavailable or ineligible',
    });
  }
}

export class AppointmentScopeForbiddenError extends ForbiddenException {
  constructor() {
    super({
      code: 'APPOINTMENT_SCOPE_FORBIDDEN',
      message: 'The appointment is outside the authenticated staff scope',
    });
  }
}

export class AppointmentScheduleConflictError extends ConflictException {
  constructor() {
    super({
      code: 'APPOINTMENT_SCHEDULE_CONFLICT',
      message: 'The provider already has an overlapping scheduled appointment',
    });
  }
}

export class AppointmentScheduleLockConflictError extends ConflictException {
  constructor() {
    super({
      code: 'APPOINTMENT_SCHEDULE_CONFLICT',
      message: 'The provider schedule is busy; retry the request',
    });
  }
}

export class AppointmentIdempotencyConflictError extends ConflictException {
  constructor() {
    super({
      code: 'APPOINTMENT_IDEMPOTENCY_CONFLICT',
      message: 'The idempotency key was already used for a different appointment request',
    });
  }
}

export class AppointmentPolicyViolationError extends UnprocessableEntityException {
  constructor(rule: string) {
    super({
      code: 'APPOINTMENT_POLICY_VIOLATION',
      message: 'The appointment does not satisfy the active scheduling policy',
      rule,
    });
  }
}

export class AppointmentStateConflictError extends ConflictException {
  constructor() {
    super({
      code: 'APPOINTMENT_STATE_CONFLICT',
      message: 'The appointment state changed or does not allow this operation',
    });
  }
}
