import { ForbiddenException } from '@nestjs/common';

export class AuthorizationForbiddenError extends ForbiddenException {
  constructor() {
    super({ code: 'AUTH_FORBIDDEN', message: 'You do not have permission to perform this action' });
  }
}
