import { Injectable } from '@nestjs/common';
import type { PlatformSession } from '@prisma/client';
import { PlatformSessionRepository } from '../repositories/platform-session.repository';
import { TokenGeneratorService } from '../security/token-generator.service';
import { TokenHasherService } from '../security/token-hasher.service';
import {
  RefreshRotationFailedError,
  RefreshSessionCompromisedError,
  RefreshSessionRevokedError,
  RefreshTokenExpiredError,
  RefreshTokenInvalidError,
  RefreshTokenReusedError,
} from '../errors/auth.errors';

export interface RotatedRefreshToken {
  refreshToken: string;
  session: PlatformSession;
}

@Injectable()
export class RefreshTokenService {
  constructor(
    private readonly sessions: PlatformSessionRepository,
    private readonly generator: TokenGeneratorService,
    private readonly hasher: TokenHasherService,
  ) {}

  issue(): { token: string; hash: string } {
    const token = this.generator.generateRefreshToken();
    return { token, hash: this.hasher.hash(token) };
  }

  async rotate(presentedToken: string): Promise<RotatedRefreshToken> {
    if (!presentedToken) throw new RefreshTokenInvalidError();
    const presentedHash = this.hasher.hash(presentedToken);
    const next = this.issue();
    let result;
    try {
      result = await this.sessions.rotateByRefreshTokenHash(presentedHash, next.hash);
    } catch {
      throw new RefreshRotationFailedError();
    }
    if (result.kind === 'rotated') return { refreshToken: next.token, session: result.session };
    if (result.kind === 'reused') throw new RefreshTokenReusedError();
    if (result.kind === 'revoked') throw new RefreshSessionRevokedError();
    if (result.kind === 'compromised') throw new RefreshSessionCompromisedError();
    if (result.kind === 'expired') throw new RefreshTokenExpiredError();
    throw new RefreshTokenInvalidError();
  }
}
