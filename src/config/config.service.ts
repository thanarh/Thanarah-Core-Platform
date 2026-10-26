import { Injectable } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';
import type { EnvConfig } from './env.schema';
import {
  getDevelopmentMysqlUrlStatus,
  isSafeDevelopmentMysqlUrl,
} from './database-url-policy';

@Injectable()
export class ConfigService {
  constructor(private readonly config: NestConfigService<EnvConfig, true>) {}

  get nodeEnv(): string {
    return this.config.get('NODE_ENV', { infer: true });
  }

  get port(): number {
    return this.config.get('PORT', { infer: true });
  }

  get databaseUrl(): string {
    if (this.isDevelopment) {
      return isSafeDevelopmentMysqlUrl(this.developmentMysqlDatabaseUrl) ?
        this.developmentMysqlDatabaseUrl :
        '';
    }
    return this.config.get('DATABASE_URL', { infer: true });
  }

  get developmentMysqlUrlStatus(): string {
    return getDevelopmentMysqlUrlStatus(this.developmentMysqlDatabaseUrl);
  }

  private get developmentMysqlDatabaseUrl(): string {
    return this.config.get('MYSQL_DATABASE_URL', { infer: true });
  }

  get tenantStorageProvider(): 'disabled' | 'memory' | 'mongodb' {
    return this.config.get('TENANT_STORAGE_PROVIDER', { infer: true });
  }

  get tenantStorageMongoUri(): string {
    return this.config.get('TENANT_STORAGE_MONGO_URI', { infer: true });
  }

  get jwtAccessSecret(): string {
    return this.config.get('JWT_ACCESS_SECRET', { infer: true });
  }

  get accessTokenTtlMinutes(): number {
    return this.config.get('AUTH_ACCESS_TOKEN_TTL_MINUTES', { infer: true });
  }

  get refreshTokenTtlDays(): number {
    return this.config.get('AUTH_REFRESH_TOKEN_TTL_DAYS', { infer: true });
  }

  get maxFailedLoginAttempts(): number {
    return this.config.get('AUTH_MAX_FAILED_LOGIN_ATTEMPTS', { infer: true });
  }

  get loginLockMinutes(): number {
    return this.config.get('AUTH_LOGIN_LOCK_MINUTES', { infer: true });
  }

  get refreshCookieName(): string {
    return this.config.get('AUTH_REFRESH_COOKIE_NAME', { infer: true });
  }

  get refreshCookieDomain(): string | undefined {
    return this.config.get('AUTH_REFRESH_COOKIE_DOMAIN', { infer: true }) || undefined;
  }

  get refreshCookieSecure(): boolean {
    return this.config.get('AUTH_REFRESH_COOKIE_SECURE', { infer: true });
  }

  get refreshCookieSameSite(): 'strict' | 'lax' | 'none' {
    return this.config.get('AUTH_REFRESH_COOKIE_SAME_SITE', { infer: true });
  }

  get throttleTtl(): number {
    return this.config.get('THROTTLE_TTL', { infer: true });
  }

  get throttleLimit(): number {
    return this.config.get('THROTTLE_LIMIT', { infer: true });
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  get isDevelopment(): boolean {
    return this.nodeEnv === 'development';
  }

  get trustedProxies(): string[] {
    return this.config.get('AUTH_TRUSTED_PROXIES', { infer: true });
  }
}
