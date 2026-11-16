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
    /** Legacy tooling only; application persistence is MongoDB. */
    DATABASE_URL: z.string().default(''),
    MYSQL_DATABASE_URL: z.string().default(''),
    TENANT_STORAGE_PROVIDER: z.enum(['disabled', 'memory', 'mongodb']).default('mongodb'),
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
    AI_EXTERNAL_INFERENCE_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    AI_OPENAI_API_KEY: z.string().default(''),
    AI_OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
    AI_OLLAMA_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    THANARAH_API_BASE_URL: z.string().url().default('https://ai.thanarah.com'),
    THANARAH_API_KEY: z.string().default(''),
    THANARAH_EMBED_KEY: z.string().default(''),
    THANARAH_EMBED_INTEGRATION_ID: z
      .string()
      .regex(/^[a-f0-9]{24}$/iu)
      .default('6afa6048869da5a0dc6f4c21'),
    THANARAH_EMBED_ALLOWED_ORIGINS: z.string().default('https://thanarah.com'),
    WHATSAPP_OTP_HMAC_SECRET: z.string().default(''),
    AUTH_TRUSTED_PROXIES: trustedProxySchema,
    THROTTLE_TTL: z.coerce.number().int().positive().default(60000),
    THROTTLE_LIMIT: z.coerce.number().int().positive().default(100),
  })
  .superRefine((config, context) => {
    if (
      config.PLATFORM_MONGO_URI.trim() &&
      !/^mongodb(?:\+srv)?:\/\/[^/\s?#]+(?:\/|\?|$)/u.test(config.PLATFORM_MONGO_URI.trim())
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PLATFORM_MONGO_URI'],
        message: 'Platform storage requires a valid MongoDB connection URI',
      });
    }
    if (
      config.PLATFORM_MONGO_DATABASE.trim() &&
      (!/^[A-Za-z0-9_-]{1,63}$/u.test(config.PLATFORM_MONGO_DATABASE) ||
        ['admin', 'config', 'local'].includes(config.PLATFORM_MONGO_DATABASE.toLowerCase()))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PLATFORM_MONGO_DATABASE'],
        message: 'Platform storage requires a non-reserved MongoDB database name',
      });
    }
    if (config.NODE_ENV !== 'development') {
      if (!config.PLATFORM_MONGO_URI.trim()) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['PLATFORM_MONGO_URI'],
          message: 'Platform MongoDB is required outside development',
        });
      }
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
      !config.TENANT_STORAGE_MONGO_URI.trim() &&
      !config.PLATFORM_MONGO_URI.trim()
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TENANT_STORAGE_MONGO_URI'],
        message: 'A MongoDB connection for tenant storage is required in production',
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
    if (config.AI_EXTERNAL_INFERENCE_ENABLED && !config.AI_OPENAI_API_KEY.trim()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AI_OPENAI_API_KEY'],
        message: 'An AI provider secret is required when external inference is enabled',
      });
    }
    if (config.AI_EXTERNAL_INFERENCE_ENABLED) {
      try {
        if (new URL(config.AI_OPENAI_BASE_URL).protocol !== 'https:') {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['AI_OPENAI_BASE_URL'],
            message: 'Hosted AI provider endpoints must use HTTPS',
          });
        }
      } catch {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['AI_OPENAI_BASE_URL'],
          message: 'Hosted AI provider endpoint is invalid',
        });
      }
    }
    try {
      const apiBaseUrl = new URL(config.THANARAH_API_BASE_URL);
      if (
        apiBaseUrl.protocol !== 'https:' ||
        apiBaseUrl.username ||
        apiBaseUrl.password ||
        apiBaseUrl.search ||
        apiBaseUrl.hash
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['THANARAH_API_BASE_URL'],
          message:
            'Thanarah API base URL must be an HTTPS origin without credentials or query data',
        });
      }
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['THANARAH_API_BASE_URL'],
        message: 'Thanarah API base URL is invalid',
      });
    }
    const embedOrigins = config.THANARAH_EMBED_ALLOWED_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
    if (embedOrigins.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['THANARAH_EMBED_ALLOWED_ORIGINS'],
        message: 'At least one embed origin must be configured',
      });
    }
    for (const origin of embedOrigins) {
      try {
        const parsed = new URL(origin);
        if (
          parsed.protocol !== 'https:' ||
          parsed.origin !== origin ||
          parsed.username ||
          parsed.password
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['THANARAH_EMBED_ALLOWED_ORIGINS'],
            message: 'Embed origins must be exact HTTPS origins without paths or credentials',
          });
          break;
        }
      } catch {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['THANARAH_EMBED_ALLOWED_ORIGINS'],
          message: 'An embed origin is invalid',
        });
        break;
      }
    }
    if (config.THANARAH_API_KEY.trim() && config.WHATSAPP_OTP_HMAC_SECRET.length < 32) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['WHATSAPP_OTP_HMAC_SECRET'],
        message: 'A separate OTP signing secret of at least 32 characters is required',
      });
    }
  });

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const formatted = result.error.issues
      .map((e) => `  ${e.path.join('.')}: ${e.message}`)
      .join('\n');

    throw new Error(`Environment configuration is invalid:\n${formatted}`);
  }

  return result.data;
}
