import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

export class BranchInputValidationError extends BadRequestException {
  constructor() {
    super({ code: 'BRANCH_INPUT_INVALID', message: 'Branch details are invalid' });
  }
}

export class BranchFacilityIdInvalidError extends BadRequestException {
  constructor() {
    super({ code: 'BRANCH_FACILITY_ID_INVALID', message: 'Facility identifier is invalid' });
  }
}

export class BranchIdInvalidError extends BadRequestException {
  constructor() {
    super({ code: 'BRANCH_ID_INVALID', message: 'Branch identifier is invalid' });
  }
}

export class BranchFacilityNotFoundError extends NotFoundException {
  constructor() {
    super({
      code: 'BRANCH_FACILITY_NOT_FOUND',
      message: 'Facility was not found in the trusted tenant',
    });
  }
}

export class BranchNotFoundError extends NotFoundException {
  constructor() {
    super({
      code: 'BRANCH_NOT_FOUND',
      message: 'Branch was not found under the requested Facility',
    });
  }
}

export class BranchParentUnavailableError extends ConflictException {
  constructor() {
    super({
      code: 'BRANCH_PARENT_UNAVAILABLE',
      message: 'Branch operations require an active tenant and active Facility',
    });
  }
}

export class BranchLifecycleConflictError extends ConflictException {
  constructor() {
    super({
      code: 'BRANCH_STATUS_TRANSITION_INVALID',
      message: 'The requested Branch status transition is not allowed',
    });
  }
}
