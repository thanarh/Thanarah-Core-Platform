import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  /**
   * MySQL / MariaDB connection string.
   * - Production (cPanel): set in the Node.js app environment as
   *   mysql://USER:PASS@localhost:3306/thanarah_platform
   * - Replit development: left unset; the application starts without a
   *   live database connection and PrismaService.isConnected() returns false.
   */
  DATABASE_URL: z.string().default(''),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  THROTTLE_TTL: z.coerce.number().int().positive().default(60000),
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(100),
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
