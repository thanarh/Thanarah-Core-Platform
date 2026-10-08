import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

export class PatientInputValidationError extends BadRequestException {
  constructor() {
    super({
      code: 'PATIENT_INPUT_INVALID',
      message: 'Patient details are invalid',
    });
  }
}

export class PatientIdInvalidError extends BadRequestException {
  constructor() {
    super({
      code: 'PATIENT_ID_INVALID',
      message: 'Patient identifier is invalid',
    });
  }
}

export class PatientNotFoundError extends NotFoundException {
  constructor() {
    super({
      code: 'PATIENT_NOT_FOUND',
      message: 'Patient was not found in the trusted tenant',
    });
  }
}

export class PatientNumberConflictError extends ConflictException {
  constructor() {
    super({
      code: 'PATIENT_NUMBER_CONFLICT',
      message: 'A patient with that number already exists in the tenant',
    });
  }
}

export class PatientPossibleDuplicateError extends ConflictException {
  constructor() {
    super({
      code: 'PATIENT_DUPLICATE_POSSIBLE',
      message: 'A possible matching patient already exists.',
    });
  }
}

export class PatientLifecycleConflictError extends ConflictException {
  constructor() {
    super({
      code: 'PATIENT_STATUS_TRANSITION_INVALID',
      message: 'The requested patient status transition is not allowed',
    });
  }
}
