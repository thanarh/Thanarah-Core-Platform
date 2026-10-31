export class PlatformMongoNotConfiguredError extends Error {
  constructor() {
    super('Platform MongoDB is not configured');
    this.name = 'PlatformMongoNotConfiguredError';
  }
}

export class PlatformMongoUnavailableError extends Error {
  constructor() {
    super('Platform storage is unavailable');
    this.name = 'PlatformMongoUnavailableError';
  }
}

export class PlatformDocumentValidationError extends Error {
  constructor() {
    super('Platform document validation failed');
    this.name = 'PlatformDocumentValidationError';
  }
}

export class PlatformDocumentConflictError extends Error {
  constructor() {
    super('Platform document conflicts with an existing record');
    this.name = 'PlatformDocumentConflictError';
  }
}
