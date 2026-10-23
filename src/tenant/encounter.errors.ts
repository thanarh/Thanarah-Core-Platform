import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

export class EncounterInputValidationError extends BadRequestException {
  constructor() {
    super({ code: 'ENCOUNTER_INPUT_INVALID', message: 'Encounter input is invalid' });
  }
}

export class EncounterNotFoundError extends NotFoundException {
  constructor() {
    super({ code: 'ENCOUNTER_NOT_FOUND', message: 'Encounter not found' });
  }
}

export class EncounterReferenceInvalidError extends UnprocessableEntityException {
  constructor() {
    super({
      code: 'ENCOUNTER_REFERENCE_INVALID',
      message: 'One or more encounter references are unavailable or ineligible',
    });
  }
}

export class EncounterScopeForbiddenError extends ForbiddenException {
  constructor() {
    super({
      code: 'ENCOUNTER_SCOPE_FORBIDDEN',
      message: 'The encounter is outside the authenticated staff scope',
    });
  }
}

export class EncounterStateConflictError extends ConflictException {
  constructor() {
    super({
      code: 'ENCOUNTER_STATE_CONFLICT',
      message: 'The encounter is finalized or the requested transition is not allowed',
    });
  }
}

export class EncounterVersionConflictError extends ConflictException {
  constructor() {
    super({
      code: 'ENCOUNTER_VERSION_CONFLICT',
      message: 'The encounter changed since it was loaded; reload before saving',
    });
  }
}

export class EncounterAppointmentConflictError extends ConflictException {
  constructor() {
    super({
      code: 'ENCOUNTER_APPOINTMENT_ALREADY_LINKED',
      message: 'An active encounter already exists for this appointment',
    });
  }
}

export class EncounterIdempotencyConflictError extends ConflictException {
  constructor() {
    super({
      code: 'ENCOUNTER_IDEMPOTENCY_CONFLICT',
      message: 'This idempotency key was already used for a different encounter request',
    });
  }
}

export class EncounterIdempotencyInProgressError extends ConflictException {
  constructor() {
    super({
      code: 'ENCOUNTER_IDEMPOTENCY_IN_PROGRESS',
      message: 'A request with this idempotency key is still being processed',
    });
  }
}

export class EncounterIdempotencyReviewError extends ConflictException {
  constructor() {
    super({
      code: 'ENCOUNTER_IDEMPOTENCY_REVIEW_REQUIRED',
      message: 'The previous request has an ambiguous outcome and requires review',
    });
  }
}

export class EncounterHistoryLimitError extends ConflictException {
  constructor() {
    super({
      code: 'ENCOUNTER_HISTORY_LIMIT_REACHED',
      message: 'Encounter history is full; contact an administrator',
    });
  }
}

export class EncounterTimeZoneUnavailableError extends UnprocessableEntityException {
  constructor() {
    super({
      code: 'ENCOUNTER_TIME_ZONE_UNAVAILABLE',
      message: 'An active facility scheduling policy is required for local-date filtering',
    });
  }
}
