import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '../config/config.module';
import { DatabaseModule } from '../database/database.module';
import { AuthController } from './auth.controller';
import { PlatformAuthGuard } from './guards/platform-auth.guard';
import { PlatformAuthorizationGuard } from './guards/platform-authorization.guard';
import { PlatformAuthorizationRepository } from './repositories/platform-authorization.repository';
import { PlatformSessionRepository } from './repositories/platform-session.repository';
import { PlatformUserRepository } from './repositories/platform-user.repository';
import { PasswordHasherService } from './security/password-hasher.service';
import { PasswordPolicyService } from './security/password-policy.service';
import { TokenGeneratorService } from './security/token-generator.service';
import { TokenHasherService } from './security/token-hasher.service';
import { AccessTokenService } from './services/access-token.service';
import { AuthCookieService } from './services/auth-cookie.service';
import { PlatformSessionService } from './services/platform-session.service';
import { PlatformAuthorizationService } from './services/platform-authorization.service';
import { PlatformRolePolicyService } from './services/platform-role-policy.service';
import { RefreshTokenService } from './services/refresh-token.service';
import { AuthenticationService } from './services/authentication.service';

const providers = [
  AccessTokenService,
  AuthCookieService,
  PasswordHasherService,
  PasswordPolicyService,
  PlatformAuthGuard,
  PlatformAuthorizationGuard,
  PlatformAuthorizationRepository,
  PlatformAuthorizationService,
  PlatformRolePolicyService,
  PlatformSessionRepository,
  PlatformSessionService,
  PlatformUserRepository,
  RefreshTokenService,
  AuthenticationService,
  TokenGeneratorService,
  TokenHasherService,
];

@Module({
  imports: [ConfigModule, DatabaseModule, JwtModule.register({})],
  controllers: [AuthController],
  providers,
  exports: providers,
})
export class AuthModule {}
