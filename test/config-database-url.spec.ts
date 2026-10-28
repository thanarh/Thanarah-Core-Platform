import type { ConfigService as NestConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { ConfigService } from '../src/config/config.service';
import type { EnvConfig } from '../src/config/env.schema';
import {
  getSafeDatabaseUrlDiagnostics,
  getDevelopmentMysqlUrlStatus,
  isSafeDevelopmentMysqlUrl,
  resolveCentralDatabaseUrl,
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

  it('selects the validated MySQL development URL and ignores managed PostgreSQL explicitly', () => {
    expect(
      resolveCentralDatabaseUrl({
        nodeEnv: 'development',
        developmentMysqlUrl: 'mysql://dev-host/thanarah_dev',
        databaseUrl: 'postgresql://managed-host/platform',
      }),
    ).toEqual({ url: 'mysql://dev-host/thanarah_dev', status: 'ready' });
  });

  it('rejects a conflicting MySQL DATABASE_URL in development', () => {
    expect(
      resolveCentralDatabaseUrl({
        nodeEnv: 'development',
        developmentMysqlUrl: 'mysql://dev-host/thanarah_dev',
        databaseUrl: 'mysql://other-host/thanarah_test',
      }),
    ).toEqual({ url: '', status: 'conflicting-database-urls' });
  });

  it('keeps the production Prisma URL selection unchanged', () => {
    expect(
      resolveCentralDatabaseUrl({
        nodeEnv: 'production',
        developmentMysqlUrl: 'mysql://dev-host/thanarah_dev',
        databaseUrl: 'mysql://central-host/thanarah_platform',
      }),
    ).toEqual({ url: 'mysql://central-host/thanarah_platform', status: 'ready' });
  });

  it('classifies unsafe development targets without exposing connection details', () => {
    expect(getDevelopmentMysqlUrlStatus('')).toBe('missing');
    expect(getDevelopmentMysqlUrlStatus('not a url')).toBe('invalid-url');
    expect(getDevelopmentMysqlUrlStatus('postgresql://managed-host/heliumdb')).toBe('not-mysql');
    expect(getDevelopmentMysqlUrlStatus('mysql://db.example.test/thanarah_platform')).toBe(
      'database-name-not-development',
    );
    expect(getDevelopmentMysqlUrlStatus('mysql://prod-db.example.test/thanarah_platform_dev')).toBe(
      'production-host',
    );
  });

  it('reports only safe URL diagnostics for malformed and alternate schemes', () => {
    expect(
      getSafeDatabaseUrlDiagnostics(
        'postgresql://user:private@example.test/db',
        'MYSQL_DATABASE_URL',
        true,
      ),
    ).toEqual({
      source: 'MYSQL_DATABASE_URL',
      present: true,
      empty: false,
      urlParses: true,
      scheme: 'postgresql',
      developmentDatabaseNameSafe: false,
      productionLikeHost: false,
    });
    expect(getSafeDatabaseUrlDiagnostics('  ', 'MYSQL_DATABASE_URL', true)).toMatchObject({
      present: true,
      empty: true,
      urlParses: false,
      scheme: 'missing',
    });
    expect(getSafeDatabaseUrlDiagnostics('not a URL', 'MYSQL_DATABASE_URL', true)).toMatchObject({
      urlParses: false,
      scheme: 'invalid',
    });
  });
});
