import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

export class ClinicWebsiteInputError extends BadRequestException {
  constructor() {
    super({
      code: 'CLINIC_WEBSITE_INPUT_INVALID',
      message: 'Website content or version is invalid',
    });
  }
}

export class ClinicWebsiteVersionConflictError extends ConflictException {
  constructor() {
    super({
      code: 'CLINIC_WEBSITE_VERSION_CONFLICT',
      message: 'The website changed; reload it before saving',
    });
  }
}

export class ClinicWebsiteSlugConflictError extends ConflictException {
  constructor() {
    super({
      code: 'CLINIC_WEBSITE_SLUG_CONFLICT',
      message: 'This test path is already in use',
    });
  }
}

export class ClinicWebsiteVersionNotFoundError extends NotFoundException {
  constructor() {
    super({
      code: 'CLINIC_WEBSITE_VERSION_NOT_FOUND',
      message: 'The requested website version is unavailable',
    });
  }
}

export class ClinicWebsiteNotPublishedError extends NotFoundException {
  constructor() {
    super({
      code: 'CLINIC_WEBSITE_NOT_PUBLISHED',
      message: 'The clinic website is not available',
    });
  }
}
