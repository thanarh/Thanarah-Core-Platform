import type { ConfigService as NestConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { ConfigService } from '../src/config/config.service';
import type { EnvConfig } from '../src/config/env.schema';
import {
  getDevelopmentMysqlUrlStatus,
  isSafeDevelopmentMysqlUrl,
} from '../src/config/database-url-policy';

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
    expect(configFor('development').databaseUrl).toBe('mysql://development-host/thanarah_dev');
  });

  it('keeps DATABASE_URL for production', () => {
    expect(configFor('production').databaseUrl).toBe('postgresql://managed-host/heliumdb');
  });

  it('rejects the managed PostgreSQL URL and development URLs without a dev database name', () => {
    expect(isSafeDevelopmentMysqlUrl('postgresql://managed-host/heliumdb')).toBe(false);
    expect(isSafeDevelopmentMysqlUrl('mysql://db.example.test/thanarah_platform')).toBe(false);
    expect(isSafeDevelopmentMysqlUrl('mysql://prod-db.example.test/thanarah_platform_dev')).toBe(
      false,
    );
  });

  it('accepts a MySQL URL with an explicit development database name', () => {
    expect(isSafeDevelopmentMysqlUrl('mysql://db.example.test/thanarah_platform_dev')).toBe(true);
  });

  it('classifies unsafe development targets without exposing connection details', () => {
    expect(getDevelopmentMysqlUrlStatus('')).toBe('missing');
    expect(getDevelopmentMysqlUrlStatus('not a url')).toBe('invalid-url');
    expect(getDevelopmentMysqlUrlStatus('postgresql://managed-host/heliumdb')).toBe('not-mysql');
    expect(getDevelopmentMysqlUrlStatus('mysql://db.example.test/thanarah_platform')).toBe(
      'database-name-not-development',
    );
    expect(
      getDevelopmentMysqlUrlStatus('mysql://prod-db.example.test/thanarah_platform_dev'),
    ).toBe('production-host');
  });
});
