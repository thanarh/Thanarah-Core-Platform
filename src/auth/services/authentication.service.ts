import { Injectable } from '@nestjs/common';
import { ConfigService } from '../../config/config.service';
import {
  AccountInactiveError,
  AccountLockedError,
  InvalidCredentialsError,
} from '../errors/auth.errors';
import { PlatformAuthorizationRepository } from '../repositories/platform-authorization.repository';
import { PlatformSessionService } from './platform-session.service';
import {
  PlatformUserRepository,
  type LoginUserRecord,
} from '../repositories/platform-user.repository';
import { PasswordHasherService } from '../security/password-hasher.service';
import { TokenGeneratorService } from '../security/token-generator.service';
import { RefreshTokenService } from './refresh-token.service';
import { AccessTokenService } from './access-token.service';
import {
  RefreshSessionCompromisedError,
  RefreshSessionRevokedError,
  RefreshTokenExpiredError,
  RefreshTokenInvalidError,
  RefreshTokenReusedError,
} from '../errors/auth.errors';

export interface AuthenticationRequestContext {
  ipAddress: string;
  userAgent: string | null;
}

const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=1$kTFwsu7VK9B01289VInf6g$8hT6lPgFXBOUwWu44L1sX1DX9u8RcjRJG2zvRpjpj6Y';

@Injectable()
export class AuthenticationService {
  constructor(
    private readonly users: PlatformUserRepository,
    private readonly passwords: PasswordHasherService,
    private readonly config: ConfigService,
    private readonly sessions: PlatformSessionService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly access: AccessTokenService,
    private readonly generator: TokenGeneratorService,
    private readonly authorization: PlatformAuthorizationRepository,
  ) {}

  async login(
    emailInput: string,
    password: string,
    context: AuthenticationRequestContext,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const email = typeof emailInput === 'string' ? emailInput.trim().toLowerCase() : '';
    const record = await this.users.findLoginRecordByEmail(email);
    let verified = false;
    try {
      verified = await this.passwords.verify(
        record?.passwordHash ?? DUMMY_HASH,
        typeof password === 'string' ? password : '',
      );
    } catch {
      verified = false;
    }
    if (!record || !verified) {
      if (record) await this.recordFailure(record);
      throw new InvalidCredentialsError();
    }
    if (record.lockedUntil && record.lockedUntil > new Date()) throw new AccountLockedError();
    if (record.status !== 'ACTIVE') throw new AccountInactiveError();
    await this.users.resetFailedLogins(record.id);
    const issued = this.refreshTokens.issue();
    const session = await this.sessions.create({
      userId: record.id,
      refreshTokenHash: issued.hash,
      tokenFamilyId: this.generator.generateTokenFamilyId(),
      expiresAt: new Date(Date.now() + this.config.refreshTokenTtlDays * 86400000),
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
    const roleIds = await this.authorization.findRoleIdsByUserId(record.id);
    return {
      refreshToken: issued.token,
      accessToken: await this.access.sign({
        sub: record.id,
        sessionId: session.id,
        tokenVersion: record.tokenVersion,
        platformRoleIds: roleIds,
      }),
    };
  }

  async refresh(presentedToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const rotated = await this.refreshTokens.rotate(presentedToken);
    const user = await this.users.findAuthRecordById(rotated.session.userId);
    if (!user || user.status !== 'ACTIVE') throw new AccountInactiveError();
    const roles = await this.authorization.findRoleIdsByUserId(user.id);
    return {
      refreshToken: rotated.refreshToken,
      accessToken: await this.access.sign({
        sub: user.id,
        sessionId: rotated.session.id,
        tokenVersion: user.tokenVersion,
        platformRoleIds: roles,
      }),
    };
  }

  static isCredentialRefreshError(error: unknown): boolean {
    return (
      error instanceof RefreshTokenInvalidError ||
      error instanceof RefreshTokenExpiredError ||
      error instanceof RefreshSessionRevokedError ||
      error instanceof RefreshSessionCompromisedError ||
      error instanceof RefreshTokenReusedError ||
      error instanceof AccountInactiveError
    );
  }

  private async recordFailure(record: LoginUserRecord): Promise<void> {
    await this.users.recordFailedLogin(
      record.id,
      this.config.maxFailedLoginAttempts,
      this.config.loginLockMinutes,
    );
  }
}
