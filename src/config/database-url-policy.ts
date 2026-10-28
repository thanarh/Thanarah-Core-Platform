export type DevelopmentMysqlUrlStatus =
  | 'missing'
  | 'invalid-url'
  | 'not-mysql'
  | 'database-name-not-development'
  | 'production-host'
  | 'conflicting-database-urls'
  | 'ready';

export function getDevelopmentMysqlUrlStatus(databaseUrl: string): DevelopmentMysqlUrlStatus {
  if (!databaseUrl) return 'missing';

  try {
    const parsed = new URL(databaseUrl);
    if (parsed.protocol !== 'mysql:') return 'not-mysql';

    const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, '')).toLowerCase();
    const hostname = parsed.hostname.toLowerCase();
    if (/(prod|production|live)/.test(hostname)) return 'production-host';

    const hasDevelopmentName = /(^|[_-])(dev|development|test|sandbox|local)([_-]|$)/.test(
      databaseName,
    );
    if (!hasDevelopmentName) return 'database-name-not-development';

    return 'ready';
  } catch {
    return 'invalid-url';
  }
}

export interface CentralDatabaseUrlConfig {
  nodeEnv: string;
  databaseUrl: string;
  developmentMysqlUrl: string;
}

export interface CentralDatabaseUrlResolution {
  url: string;
  status: DevelopmentMysqlUrlStatus;
}

function targetsSameMysqlDatabase(first: string, second: string): boolean {
  try {
    const left = new URL(first);
    const right = new URL(second);
    if (left.protocol !== 'mysql:' || right.protocol !== 'mysql:') return false;

    const databasePath = (url: URL): string => decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    const effectivePort = (url: URL): string => url.port || '3306';
    return (
      left.hostname.toLowerCase() === right.hostname.toLowerCase() &&
      effectivePort(left) === effectivePort(right) &&
      databasePath(left) === databasePath(right)
    );
  } catch {
    return false;
  }
}

function isMysqlUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'mysql:';
  } catch {
    return false;
  }
}

/**
 * In development, MYSQL_DATABASE_URL is the only accepted MySQL source.
 * DATABASE_URL is explicitly ignored when it is Replit's non-MySQL managed
 * URL; a second MySQL URL must demonstrably identify the same target.
 */
export function resolveCentralDatabaseUrl(
  config: CentralDatabaseUrlConfig,
): CentralDatabaseUrlResolution {
  if (config.nodeEnv !== 'development') {
    return {
      url: config.databaseUrl,
      status: config.databaseUrl ? 'ready' : 'missing',
    };
  }

  const status = getDevelopmentMysqlUrlStatus(config.developmentMysqlUrl);
  if (status !== 'ready') return { url: '', status };

  if (
    isMysqlUrl(config.databaseUrl) &&
    !targetsSameMysqlDatabase(config.databaseUrl, config.developmentMysqlUrl)
  ) {
    return { url: '', status: 'conflicting-database-urls' };
  }

  return { url: config.developmentMysqlUrl, status: 'ready' };
}

export function isSafeDevelopmentMysqlUrl(databaseUrl: string): boolean {
  return getDevelopmentMysqlUrlStatus(databaseUrl) === 'ready';
}
