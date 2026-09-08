import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '../config/config.module';
import { DatabaseModule } from '../database/database.module';
import { PlatformAuthGuard } from './guards/platform-auth.guard';
import { PlatformSessionRepository } from './repositories/platform-session.repository';
import { PlatformUserRepository } from './repositories/platform-user.repository';
import { PasswordHasherService } from './security/password-hasher.service';
import { PasswordPolicyService } from './security/password-policy.service';
import { TokenGeneratorService } from './security/token-generator.service';
import { TokenHasherService } from './security/token-hasher.service';
import { AccessTokenService } from './services/access-token.service';
import { AuthCookieService } from './services/auth-cookie.service';
import { PlatformSessionService } from './services/platform-session.service';
import { RefreshTokenService } from './services/refresh-token.service';

const providers = [
  AccessTokenService,
  AuthCookieService,
  PasswordHasherService,
  PasswordPolicyService,
  PlatformAuthGuard,
  PlatformSessionRepository,
  PlatformSessionService,
  PlatformUserRepository,
  RefreshTokenService,
  TokenGeneratorService,
  TokenHasherService,
];

@Module({
  imports: [ConfigModule, DatabaseModule, JwtModule.register({})],
  providers,
  exports: providers,
})
export class AuthModule {}
