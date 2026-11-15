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
    reply.clearCookie(this.config.refreshCookieName, this.cookieScope());
  }

  private cookieScope(): {
    httpOnly: true;
    secure: boolean;
    sameSite: 'strict' | 'lax' | 'none';
    domain: string | undefined;
    path: '/';
    partitioned?: true;
  } {
    const partitionedPreview = Boolean(this.config.isReplitPreview);
    return {
      httpOnly: true,
      secure: partitionedPreview || this.config.refreshCookieSecure,
      sameSite: partitionedPreview ? 'none' : this.config.refreshCookieSameSite,
      domain: this.config.refreshCookieDomain,
      path: '/',
      ...(partitionedPreview ? { partitioned: true as const } : {}),
    };
  }

  private options(): {
    httpOnly: true;
    secure: boolean;
    sameSite: 'strict' | 'lax' | 'none';
    domain: string | undefined;
    path: '/';
    maxAge: number;
    partitioned?: true;
  } {
    return {
      ...this.cookieScope(),
      maxAge: this.config.refreshTokenTtlDays * 24 * 60 * 60,
    };
  }
}
