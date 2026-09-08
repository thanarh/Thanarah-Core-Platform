import { Controller, HttpCode, HttpStatus, Inject, Post, Res, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOperation,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { AUTH_REVOCATION_REASONS } from './auth.constants';
import type { AuthenticatedPlatformUser } from './auth.types';
import { CurrentPlatformUser } from './decorators/current-platform-user.decorator';
import { PlatformAuthGuard } from './guards/platform-auth.guard';
import { AuthCookieService } from './services/auth-cookie.service';
import { PlatformSessionService } from './services/platform-session.service';

@ApiBearerAuth()
@Controller('v1/auth')
export class AuthController {
  constructor(
    @Inject(PlatformSessionService)
    private readonly sessions: PlatformSessionService,
    @Inject(AuthCookieService)
    private readonly cookies: AuthCookieService,
  ) {}

  @Post('logout')
  @UseGuards(PlatformAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Log out of the current platform session' })
  @ApiNoContentResponse({ description: 'The current session was revoked and cookie cleared' })
  @ApiUnauthorizedResponse({ description: 'Authentication failed' })
  async logout(
    @CurrentPlatformUser() user: AuthenticatedPlatformUser,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.sessions.revokeOne(user.sessionId, user.userId, AUTH_REVOCATION_REASONS.USER_LOGOUT);
    this.cookies.clearRefreshToken(reply);
  }

  @Post('logout-all')
  @UseGuards(PlatformAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Log out of all platform sessions' })
  @ApiNoContentResponse({ description: 'All active user sessions were revoked and cookie cleared' })
  @ApiUnauthorizedResponse({ description: 'Authentication failed' })
  async logoutAll(
    @CurrentPlatformUser() user: AuthenticatedPlatformUser,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.sessions.revokeAll(
      user.userId,
      user.userId,
      AUTH_REVOCATION_REASONS.USER_LOGOUT_ALL,
    );
    this.cookies.clearRefreshToken(reply);
  }
}
