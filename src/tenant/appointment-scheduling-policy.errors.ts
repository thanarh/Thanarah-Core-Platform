import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';

export class SchedulingPolicyInputError extends BadRequestException {
  constructor() {
    super({
      code: 'SCHEDULING_POLICY_INPUT_INVALID',
      message: 'Scheduling policy input is invalid',
    });
  }
}

export class SchedulingPolicyNotFoundError extends NotFoundException {
  constructor() {
    super({
      code: 'SCHEDULING_POLICY_NOT_FOUND',
      message: 'Scheduling policy not found for this facility',
    });
  }
}

export class SchedulingPolicyVersionConflictError extends ConflictException {
  constructor() {
    super({
      code: 'SCHEDULING_POLICY_VERSION_CONFLICT',
      message: 'The scheduling policy changed; reload it and retry',
    });
  }
}

export class SchedulingPolicyReferenceInvalidError extends UnprocessableEntityException {
  constructor() {
    super({
      code: 'SCHEDULING_POLICY_REFERENCE_INVALID',
      message: 'One or more scheduling policy references are unavailable or ineligible',
    });
  }
}

export class SchedulingPolicyUnavailableError extends ServiceUnavailableException {
  constructor() {
    super({
      code: 'SCHEDULING_POLICY_UNAVAILABLE',
      message: 'Scheduling policy could not be verified',
    });
  }
}
