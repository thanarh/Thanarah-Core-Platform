import { Injectable } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ConfigService } from '../../config/config.service';

@Injectable()
export class AuthCookieService {
  constructor(private readonly config: ConfigService) {}

  setRefreshToken(reply: FastifyReply, token: string): void {
    reply.setCookie(this.config.refreshCookieName, token, this.options());
  }

  readRefreshToken(request: FastifyRequest): string | undefined {
    return request.cookies[this.config.refreshCookieName];
  }

  clearRefreshToken(reply: FastifyReply): void {
    reply.clearCookie(this.config.refreshCookieName, {
      path: '/',
      domain: this.config.refreshCookieDomain,
      secure: this.config.refreshCookieSecure,
      sameSite: this.config.refreshCookieSameSite,
      httpOnly: true,
    });
  }

  private options(): {
    httpOnly: true;
    secure: boolean;
    sameSite: 'strict' | 'lax' | 'none';
    domain: string | undefined;
    path: '/';
    maxAge: number;
  } {
    return {
      httpOnly: true,
      secure: this.config.refreshCookieSecure,
      sameSite: this.config.refreshCookieSameSite,
      domain: this.config.refreshCookieDomain,
      path: '/',
      maxAge: this.config.refreshTokenTtlDays * 24 * 60 * 60,
    };
  }
}
