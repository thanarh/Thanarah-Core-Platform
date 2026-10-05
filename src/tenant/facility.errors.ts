import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

export class FacilityInputValidationError extends BadRequestException {
  constructor() {
    super({ code: 'FACILITY_INPUT_INVALID', message: 'Facility details are invalid' });
  }
}

export class FacilityIdInvalidError extends BadRequestException {
  constructor() {
    super({ code: 'FACILITY_ID_INVALID', message: 'Facility identifier is invalid' });
  }
}

export class FacilityNotFoundError extends NotFoundException {
  constructor() {
    super({ code: 'FACILITY_NOT_FOUND', message: 'Facility was not found' });
  }
}

export class FacilityLifecycleConflictError extends ConflictException {
  constructor() {
    super({
      code: 'FACILITY_STATUS_TRANSITION_INVALID',
      message: 'The requested facility status transition is not allowed',
    });
  }
}
