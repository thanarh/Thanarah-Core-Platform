import { HttpException } from '@nestjs/common';
import { PlatformDocumentValidationError } from '../platform-mongo/platform-mongo.errors';

/** Preserved by the shared transaction boundary; converted only at the HTTP boundary. */
export class OperationsError extends PlatformDocumentValidationError {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly description: string,
  ) {
    super();
  }
  toHttp(): HttpException {
    return new HttpException({ code: this.code, message: this.description }, this.status);
  }
}
export function fail(code: string, description: string, status = 409): never {
  throw new OperationsError(code, status, description);
}
