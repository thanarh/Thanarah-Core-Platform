import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Optional,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiBody,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AUTH_REVOCATION_REASONS } from './auth.constants';
import type { AuthenticatedPlatformUser } from './auth.types';
import { CurrentPlatformUser } from './decorators/current-platform-user.decorator';
import { PlatformAuthGuard } from './guards/platform-auth.guard';
import { AuthCookieService } from './services/auth-cookie.service';
import { PlatformSessionService } from './services/platform-session.service';
import { AuthenticationService } from './services/authentication.service';
import { Public } from './decorators/public.decorator';
import { AuthResponseDto, LoginDto } from './dto/auth.dto';
import {
  PlatformAuditEventType,
  PlatformAuditService,
} from '../platform-security/platform-audit.service';
import type { TrustedSecurityContext } from '../platform-security/platform-security.types';

@Controller('v1/auth')
export class AuthController {
  constructor(
    @Inject(PlatformSessionService)
    private readonly sessions: PlatformSessionService,
    @Inject(AuthCookieService)
    private readonly cookies: AuthCookieService,
    @Inject(AuthenticationService)
    private readonly authentication: AuthenticationService,
    @Optional() private readonly audit?: PlatformAuditService,
  ) {}

  @Post('login')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate a platform user' })
  @ApiBody({ type: LoginDto })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiBadRequestResponse({ description: 'Malformed login request' })
  async login(
    @Body() body: LoginDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ accessToken: string }> {
    if (!body || typeof body.email !== 'string' || typeof body.password !== 'string') {
      throw new BadRequestException('Invalid login request');
    }
    const result = await this.authentication.login(body.email, body.password, {
      ipAddress: request.ip,
      userAgent:
        typeof request.headers['user-agent'] === 'string'
          ? request.headers['user-agent'].slice(0, 512)
          : null,
    });
    this.cookies.setRefreshToken(reply, result.refreshToken);
    return { accessToken: result.accessToken };
  }

  @Post('refresh')
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate the refresh session and issue an access token' })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiUnauthorizedResponse({ description: 'Refresh credential is invalid or no longer active' })
  async refreshToken(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ accessToken: string }> {
    const presented = this.cookies.readRefreshToken(request);
    try {
      const result = await this.authentication.refresh(
        presented ?? '',
        this.requestContext(request),
      );
      this.cookies.setRefreshToken(reply, result.refreshToken);
      return { accessToken: result.accessToken };
    } catch (error) {
      if (AuthenticationService.isCredentialRefreshError(error)) {
        this.cookies.clearRefreshToken(reply);
      }
      throw error;
    }
  }

  @Post('logout')
  @ApiBearerAuth()
  @UseGuards(PlatformAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Log out of the current platform session' })
  @ApiNoContentResponse({ description: 'The current session was revoked and cookie cleared' })
  @ApiUnauthorizedResponse({ description: 'Authentication failed' })
  async logout(
    @CurrentPlatformUser() user: AuthenticatedPlatformUser,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Req() request?: FastifyRequest,
  ): Promise<void> {
    await this.sessions.revokeOne(user.sessionId, user.userId, AUTH_REVOCATION_REASONS.USER_LOGOUT);
    await this.audit?.recordAudit({
      eventType: PlatformAuditEventType.AUTH_LOGOUT,
      actorUserId: user.userId,
      sessionId: user.sessionId,
      ...this.requestContext(request),
    });
    this.cookies.clearRefreshToken(reply);
  }

  @Post('logout-all')
  @ApiBearerAuth()
  @UseGuards(PlatformAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Log out of all platform sessions' })
  @ApiNoContentResponse({ description: 'All active user sessions were revoked and cookie cleared' })
  @ApiUnauthorizedResponse({ description: 'Authentication failed' })
  async logoutAll(
    @CurrentPlatformUser() user: AuthenticatedPlatformUser,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Req() request?: FastifyRequest,
  ): Promise<void> {
    await this.sessions.revokeAll(
      user.userId,
      user.userId,
      AUTH_REVOCATION_REASONS.USER_LOGOUT_ALL,
    );
    await this.audit?.recordAudit({
      eventType: PlatformAuditEventType.AUTH_LOGOUT_ALL,
      actorUserId: user.userId,
      ...this.requestContext(request),
    });
    this.cookies.clearRefreshToken(reply);
  }

  private requestContext(request?: FastifyRequest): TrustedSecurityContext {
    if (!request) return {};
    const headers = request.headers ?? {};
    const requestId = headers['x-request-id'];
    const userAgent = headers['user-agent'];
    return {
      requestId: typeof requestId === 'string' ? requestId : undefined,
      ipAddress: request.ip,
      userAgent: typeof userAgent === 'string' ? userAgent : undefined,
    };
  }
}
