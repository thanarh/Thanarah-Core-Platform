import { z } from 'zod';
import { isIP } from 'node:net';

function hasValidatedMongoTls(uri: string): boolean {
  try {
    const parsed = new URL(uri);
    const tls = parsed.searchParams.get('tls') ?? parsed.searchParams.get('ssl');
    const explicitlyDisabled =
      parsed.searchParams.get('tls')?.toLowerCase() === 'false' ||
      parsed.searchParams.get('ssl')?.toLowerCase() === 'false';
    const certificateValidationDisabled = [
      'tlsInsecure',
      'tlsAllowInvalidCertificates',
      'tlsAllowInvalidHostnames',
    ].some((key) => parsed.searchParams.get(key)?.toLowerCase() === 'true');

    if (parsed.protocol === 'mongodb+srv:') {
      return !explicitlyDisabled && !certificateValidationDisabled;
    }

    return (
      parsed.protocol === 'mongodb:' &&
      (tls?.toLowerCase() === 'true' || parsed.searchParams.get('ssl')?.toLowerCase() === 'true') &&
      !explicitlyDisabled &&
      !certificateValidationDisabled
    );
  } catch {
    return false;
  }
}

const trustedProxySchema = z
  .string()
  .default('127.0.0.1,::1')
  .transform((value, context) => {
    const entries = value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    for (const entry of entries) {
      const [address, prefix] = entry.split('/');
      const bits = isIP(address) === 4 ? 32 : isIP(address) === 6 ? 128 : 0;
      if (
        !bits ||
        (prefix !== undefined &&
          (!/^\d+$/.test(prefix) || Number(prefix) === 0 || Number(prefix) > bits))
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid trusted proxy address: ${entry}`,
        });
        return z.NEVER;
      }
    }
    return entries;
  });

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    /**
     * MySQL / MariaDB connection string for staging and production.
     * Replit manages DATABASE_URL for its PostgreSQL database, so development
     * MySQL connections use MYSQL_DATABASE_URL instead.
     */
    DATABASE_URL: z.string().default(''),
    MYSQL_DATABASE_URL: z.string().default(''),
    TENANT_STORAGE_PROVIDER: z.enum(['disabled', 'memory', 'mongodb']).default('disabled'),
    TENANT_STORAGE_MONGO_URI: z.string().default(''),
    PLATFORM_MONGO_URI: z.string().default(''),
    PLATFORM_MONGO_DATABASE: z.string().default(''),
    JWT_ACCESS_SECRET: z.string().default(''),
    AUTH_ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().max(1440).default(15),
    AUTH_REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().max(365).default(30),
    AUTH_MAX_FAILED_LOGIN_ATTEMPTS: z.coerce.number().int().positive().max(100).default(5),
    AUTH_LOGIN_LOCK_MINUTES: z.coerce.number().int().positive().max(1440).default(15),
    AUTH_REFRESH_COOKIE_NAME: z.string().min(1).default('thanarah_refresh'),
    AUTH_REFRESH_COOKIE_DOMAIN: z.string().default(''),
    AUTH_REFRESH_COOKIE_SECURE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    AUTH_REFRESH_COOKIE_SAME_SITE: z.enum(['strict', 'lax', 'none']).default('strict'),
    AUTH_TRUSTED_PROXIES: trustedProxySchema,
    THROTTLE_TTL: z.coerce.number().int().positive().default(60000),
    THROTTLE_LIMIT: z.coerce.number().int().positive().default(100),
  })
  .superRefine((config, context) => {
    if (config.NODE_ENV === 'production' && !config.DATABASE_URL) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message: 'DATABASE_URL is required in production',
      });
    }
    if (
      config.NODE_ENV === 'production' &&
      ['disabled', 'memory'].includes(config.TENANT_STORAGE_PROVIDER)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TENANT_STORAGE_PROVIDER'],
        message: 'Persistent tenant storage is required in production',
      });
    }
    if (
      Boolean(config.PLATFORM_MONGO_URI.trim()) !== Boolean(config.PLATFORM_MONGO_DATABASE.trim())
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PLATFORM_MONGO_DATABASE'],
        message: 'PLATFORM_MONGO_URI and PLATFORM_MONGO_DATABASE must be configured together',
      });
    }
    if (
      config.NODE_ENV === 'production' &&
      config.PLATFORM_MONGO_URI.trim() &&
      !hasValidatedMongoTls(config.PLATFORM_MONGO_URI.trim())
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PLATFORM_MONGO_URI'],
        message:
          'Production platform MongoDB connections must use TLS with certificate and hostname validation',
      });
    }
    if (
      config.NODE_ENV === 'production' &&
      config.TENANT_STORAGE_PROVIDER === 'mongodb' &&
      !config.TENANT_STORAGE_MONGO_URI.trim()
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TENANT_STORAGE_MONGO_URI'],
        message: 'TENANT_STORAGE_MONGO_URI is required in production',
      });
    }
    if (
      config.NODE_ENV === 'production' &&
      config.TENANT_STORAGE_PROVIDER === 'mongodb' &&
      config.TENANT_STORAGE_MONGO_URI.trim() &&
      !hasValidatedMongoTls(config.TENANT_STORAGE_MONGO_URI.trim())
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TENANT_STORAGE_MONGO_URI'],
        message:
          'Production MongoDB connections must use TLS with certificate and hostname validation',
      });
    }
    if (config.NODE_ENV === 'production' && config.JWT_ACCESS_SECRET.length < 32) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_ACCESS_SECRET'],
        message: 'JWT_ACCESS_SECRET must be at least 32 characters in production',
      });
    }
    if (config.NODE_ENV === 'production' && !config.AUTH_REFRESH_COOKIE_SECURE) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AUTH_REFRESH_COOKIE_SECURE'],
        message: 'Secure refresh cookies are required in production',
      });
    }
    if (config.AUTH_REFRESH_COOKIE_SAME_SITE === 'none' && !config.AUTH_REFRESH_COOKIE_SECURE) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AUTH_REFRESH_COOKIE_SECURE'],
        message: 'Secure cookies are required with SameSite=None',
      });
    }
  });

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const formatted = result.error.errors
      .map((e) => `  ${e.path.join('.')}: ${e.message}`)
      .join('\n');

    throw new Error(`Environment configuration is invalid:\n${formatted}`);
  }

  return result.data;
}
