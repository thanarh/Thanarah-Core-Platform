import { Injectable } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';
import type { EnvConfig } from './env.schema';
import {
  getSafeDatabaseUrlDiagnostics,
  resolveCentralDatabaseUrl,
  type CentralDatabaseUrlResolution,
  type SafeDatabaseUrlDiagnostics,
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
    return this.centralDatabaseUrlResolution.url;
  }

  get developmentMysqlUrlStatus(): string {
    return this.centralDatabaseUrlResolution.status;
  }

  get centralDatabaseDiagnostics(): SafeDatabaseUrlDiagnostics {
    const source = this.isDevelopment ? 'MYSQL_DATABASE_URL' : 'DATABASE_URL';
    const value = this.isDevelopment
      ? this.developmentMysqlDatabaseUrl
      : this.config.get('DATABASE_URL', { infer: true });
    return getSafeDatabaseUrlDiagnostics(
      value,
      source,
      Object.prototype.hasOwnProperty.call(process.env, source),
    );
  }

  private get developmentMysqlDatabaseUrl(): string {
    return this.config.get('MYSQL_DATABASE_URL', { infer: true });
  }

  private get centralDatabaseUrlResolution(): CentralDatabaseUrlResolution {
    return resolveCentralDatabaseUrl({
      nodeEnv: this.nodeEnv,
      databaseUrl: this.config.get('DATABASE_URL', { infer: true }),
      developmentMysqlUrl: this.developmentMysqlDatabaseUrl,
    });
  }

  get tenantStorageProvider(): 'disabled' | 'memory' | 'mongodb' {
    return this.config.get('TENANT_STORAGE_PROVIDER', { infer: true });
  }

  get tenantStorageMongoUri(): string {
    return (
      this.config.get('TENANT_STORAGE_MONGO_URI', { infer: true }).trim() || this.platformMongoUri
    );
  }

  get platformMongoUri(): string {
    return this.config.get('PLATFORM_MONGO_URI', { infer: true });
  }

  get platformMongoDatabase(): string {
    return this.config.get('PLATFORM_MONGO_DATABASE', { infer: true });
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

  get isReplitPreview(): boolean {
    return this.isDevelopment && Boolean(process.env.REPLIT_DEV_DOMAIN);
  }

  get trustedProxies(): string[] {
    return this.config.get('AUTH_TRUSTED_PROXIES', { infer: true });
  }

  get aiExternalInferenceEnabled(): boolean {
    return this.config.get('AI_EXTERNAL_INFERENCE_ENABLED', { infer: true });
  }

  get aiOpenAiApiKey(): string {
    return this.config.get('AI_OPENAI_API_KEY', { infer: true });
  }

  get aiOpenAiBaseUrl(): string {
    return this.config.get('AI_OPENAI_BASE_URL', { infer: true });
  }

  get aiOllamaEnabled(): boolean {
    return this.config.get('AI_OLLAMA_ENABLED', { infer: true });
  }

  get thanarahApiBaseUrl(): string {
    return this.config.get('THANARAH_API_BASE_URL', { infer: true });
  }

  get thanarahApiKey(): string {
    return this.config.get('THANARAH_API_KEY', { infer: true });
  }

  get thanarahEmbedKey(): string {
    return this.config.get('THANARAH_EMBED_KEY', { infer: true });
  }

  get thanarahEmbedIntegrationId(): string {
    return this.config.get('THANARAH_EMBED_INTEGRATION_ID', { infer: true });
  }

  get thanarahEmbedAllowedOrigins(): string[] {
    return this.config
      .get('THANARAH_EMBED_ALLOWED_ORIGINS', { infer: true })
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
  }

  get whatsappOtpHmacSecret(): string {
    return this.config.get('WHATSAPP_OTP_HMAC_SECRET', { infer: true });
  }
}
