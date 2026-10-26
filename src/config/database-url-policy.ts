export type DevelopmentMysqlUrlStatus =
  | 'missing'
  | 'invalid-url'
  | 'not-mysql'
  | 'database-name-not-development'
  | 'production-host'
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

export function isSafeDevelopmentMysqlUrl(databaseUrl: string): boolean {
  return getDevelopmentMysqlUrlStatus(databaseUrl) === 'ready';
}
