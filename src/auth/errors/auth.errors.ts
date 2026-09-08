import { HttpException, HttpStatus, UnauthorizedException } from '@nestjs/common';

export class AuthenticationError extends UnauthorizedException {
  constructor(code: string, message: string) {
    super({ code, message });
  }
}

export class AccessTokenExpiredError extends AuthenticationError {
  constructor() {
    super('AUTH_TOKEN_EXPIRED', 'Access token has expired');
  }
}
export class InvalidTokenSignatureError extends AuthenticationError {
  constructor() {
    super('AUTH_TOKEN_SIGNATURE_INVALID', 'Access token signature is invalid');
  }
}
export class InvalidTokenIssuerError extends AuthenticationError {
  constructor() {
    super('AUTH_TOKEN_ISSUER_INVALID', 'Access token issuer is invalid');
  }
}
export class InvalidTokenAudienceError extends AuthenticationError {
  constructor() {
    super('AUTH_TOKEN_AUDIENCE_INVALID', 'Access token audience is invalid');
  }
}
export class MalformedTokenError extends AuthenticationError {
  constructor() {
    super('AUTH_TOKEN_MALFORMED', 'Access token is malformed');
  }
}
export class InvalidTokenClaimsError extends AuthenticationError {
  constructor() {
    super('AUTH_TOKEN_CLAIMS_INVALID', 'Access token claims are invalid');
  }
}
export class MissingTokenSecretError extends HttpException {
  constructor() {
    super(
      { code: 'AUTH_TOKEN_SECRET_MISSING', message: 'JWT_ACCESS_SECRET is not configured' },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}

export class RefreshTokenInvalidError extends AuthenticationError {
  constructor() {
    super('AUTH_REFRESH_TOKEN_INVALID', 'Refresh token is invalid');
  }
}
export class RefreshTokenExpiredError extends AuthenticationError {
  constructor() {
    super('AUTH_REFRESH_TOKEN_EXPIRED', 'Refresh token has expired');
  }
}
export class RefreshSessionRevokedError extends AuthenticationError {
  constructor() {
    super('AUTH_REFRESH_SESSION_REVOKED', 'Refresh session has been revoked');
  }
}
export class RefreshSessionCompromisedError extends AuthenticationError {
  constructor() {
    super('AUTH_REFRESH_SESSION_COMPROMISED', 'Refresh session is compromised');
  }
}
export class RefreshTokenReusedError extends AuthenticationError {
  constructor() {
    super('AUTH_REFRESH_TOKEN_REUSED', 'Refresh token reuse detected');
  }
}
export class RefreshRotationFailedError extends AuthenticationError {
  constructor() {
    super('AUTH_REFRESH_ROTATION_FAILED', 'Refresh token rotation failed');
  }
}
