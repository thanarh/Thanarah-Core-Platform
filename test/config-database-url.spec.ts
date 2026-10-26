import type { ConfigService as NestConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { ConfigService } from '../src/config/config.service';
import type { EnvConfig } from '../src/config/env.schema';

function configFor(environment: 'development' | 'production'): ConfigService {
  const values = {
    NODE_ENV: environment,
    MYSQL_DATABASE_URL: 'mysql://development-host/thanarah_dev',
    DATABASE_URL: 'postgresql://managed-host/heliumdb',
  };
  const source = {
    get: (key: keyof typeof values) => values[key],
  } as unknown as NestConfigService<EnvConfig, true>;
  return new ConfigService(source);
}

describe('central database URL selection', () => {
  it('uses the dedicated MySQL URL in development instead of Replit DATABASE_URL', () => {
    expect(configFor('development').databaseUrl).toBe(
      'mysql://development-host/thanarah_dev',
    );
  });

  it('keeps DATABASE_URL for production', () => {
    expect(configFor('production').databaseUrl).toBe(
      'postgresql://managed-host/heliumdb',
    );
  });
});
