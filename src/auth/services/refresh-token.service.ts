import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  PlatformAuditService,
  PlatformSecurityEventType,
} from '../../platform-security/platform-audit.service';
import type { TrustedSecurityContext } from '../../platform-security/platform-security.types';
import {
  PLATFORM_SESSION_PERSISTENCE,
  type PlatformSessionPersistencePort,
  type PlatformSessionRecord,
} from '../../persistence/platform-persistence.ports';
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
  session: PlatformSessionRecord;
}

@Injectable()
export class RefreshTokenService {
  constructor(
    @Inject(PLATFORM_SESSION_PERSISTENCE)
    private readonly sessions: PlatformSessionPersistencePort,
    private readonly generator: TokenGeneratorService,
    private readonly hasher: TokenHasherService,
    @Optional() private readonly audit?: PlatformAuditService,
  ) {}

  issue(): { token: string; hash: string } {
    const token = this.generator.generateRefreshToken();
    return { token, hash: this.hasher.hash(token) };
  }

  async rotate(
    presentedToken: string,
    context?: TrustedSecurityContext,
  ): Promise<RotatedRefreshToken> {
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
    if (result.kind === 'reused') {
      await this.audit?.recordSecurityEvent({
        eventType: PlatformSecurityEventType.AUTH_REFRESH_TOKEN_REUSE,
        ...this.requestContext(context),
        sessionId: result.sessionId,
        subjectUserId: result.subjectUserId,
        metadata: { detection: 'ROTATED_TOKEN_REUSE' },
      });
      throw new RefreshTokenReusedError();
    }
    if (result.kind === 'revoked') throw new RefreshSessionRevokedError();
    if (result.kind === 'compromised') {
      await this.audit?.recordSecurityEvent({
        eventType: PlatformSecurityEventType.AUTH_REFRESH_SESSION_COMPROMISED,
        ...this.requestContext(context),
        sessionId: result.sessionId,
        subjectUserId: result.subjectUserId,
        metadata: { detection: 'COMPROMISED_SESSION' },
      });
      throw new RefreshSessionCompromisedError();
    }
    if (result.kind === 'expired') throw new RefreshTokenExpiredError();
    throw new RefreshTokenInvalidError();
  }

  private requestContext(
    context?: TrustedSecurityContext,
  ): Pick<TrustedSecurityContext, 'requestId' | 'ipAddress' | 'userAgent'> {
    return {
      requestId: context?.requestId,
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
    };
  }
}
