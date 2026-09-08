import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '../../config/config.service';
import { JWT_AUDIENCE, JWT_ISSUER } from '../auth.constants';
import type { AccessTokenClaims } from '../auth.types';
import {
  AccessTokenExpiredError,
  InvalidTokenAudienceError,
  InvalidTokenClaimsError,
  InvalidTokenIssuerError,
  InvalidTokenSignatureError,
  MalformedTokenError,
  MissingTokenSecretError,
} from '../errors/auth.errors';

@Injectable()
export class AccessTokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async sign(claims: Omit<AccessTokenClaims, 'iat' | 'exp'>): Promise<string> {
    const secret = this.requireSecret();
    this.assertClaims(claims);
    return this.jwt.signAsync(claims, {
      secret,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      expiresIn: `${this.config.accessTokenTtlMinutes}m`,
      algorithm: 'HS256',
    });
  }

  async verify(token: string): Promise<AccessTokenClaims> {
    const secret = this.requireSecret();
    try {
      const claims = await this.jwt.verifyAsync<AccessTokenClaims>(token, {
        secret,
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        algorithms: ['HS256'],
      });
      this.assertClaims(claims);
      if (!Number.isInteger(claims.iat) || !Number.isInteger(claims.exp)) {
        throw new InvalidTokenClaimsError();
      }
      return claims;
    } catch (error) {
      if (error instanceof InvalidTokenClaimsError) throw error;
      if (error instanceof Error && error.name === 'TokenExpiredError') {
        throw new AccessTokenExpiredError();
      }
      if (error instanceof Error && error.name === 'JsonWebTokenError') {
        if (error.message.includes('issuer')) throw new InvalidTokenIssuerError();
        if (error.message.includes('audience')) throw new InvalidTokenAudienceError();
        if (error.message.includes('signature')) throw new InvalidTokenSignatureError();
        throw new MalformedTokenError();
      }
      throw new MalformedTokenError();
    }
  }

  private requireSecret(): string {
    const secret = this.config.jwtAccessSecret;
    if (!secret || secret.length < 32) throw new MissingTokenSecretError();
    return secret;
  }

  private assertClaims(claims: Partial<AccessTokenClaims>): asserts claims is AccessTokenClaims {
    if (
      typeof claims.sub !== 'string' ||
      claims.sub.length === 0 ||
      typeof claims.sessionId !== 'string' ||
      claims.sessionId.length === 0 ||
      !Number.isInteger(claims.tokenVersion) ||
      (claims.tokenVersion ?? -1) < 0 ||
      !Array.isArray(claims.platformRoleIds) ||
      !claims.platformRoleIds.every((id) => typeof id === 'string' && id.length > 0)
    ) {
      throw new InvalidTokenClaimsError();
    }
  }
}
