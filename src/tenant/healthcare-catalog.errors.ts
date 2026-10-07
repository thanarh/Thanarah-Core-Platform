import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { HealthcareCatalogKind } from './healthcare-catalog.dto';

function resourceName(kind: HealthcareCatalogKind): string {
  return kind === 'department' ? 'Department' : 'Specialty';
}

function resourceCode(kind: HealthcareCatalogKind): string {
  return kind === 'department' ? 'DEPARTMENT' : 'SPECIALTY';
}

export class HealthcareCatalogInputValidationError extends BadRequestException {
  constructor(kind: HealthcareCatalogKind) {
    const resource = resourceName(kind);
    super({
      code: `${resourceCode(kind)}_INPUT_INVALID`,
      message: `${resource} details are invalid`,
    });
  }
}

export class HealthcareCatalogIdInvalidError extends BadRequestException {
  constructor(kind: HealthcareCatalogKind) {
    const resource = resourceName(kind);
    super({
      code: `${resourceCode(kind)}_ID_INVALID`,
      message: `${resource} identifier is invalid`,
    });
  }
}

export class HealthcareCatalogNotFoundError extends NotFoundException {
  constructor(kind: HealthcareCatalogKind) {
    const resource = resourceName(kind);
    super({
      code: `${resourceCode(kind)}_NOT_FOUND`,
      message: `${resource} was not found in the trusted tenant`,
    });
  }
}

export class HealthcareCatalogNameConflictError extends ConflictException {
  constructor(kind: HealthcareCatalogKind) {
    const resource = resourceName(kind);
    super({
      code: `${resourceCode(kind)}_NAME_CONFLICT`,
      message: `A ${resource.toLowerCase()} with that name already exists in the tenant`,
    });
  }
}

export class HealthcareCatalogLifecycleConflictError extends ConflictException {
  constructor(kind: HealthcareCatalogKind) {
    const resource = resourceName(kind);
    super({
      code: `${resourceCode(kind)}_STATUS_TRANSITION_INVALID`,
      message: `The requested ${resource.toLowerCase()} status transition is not allowed`,
    });
  }
}
