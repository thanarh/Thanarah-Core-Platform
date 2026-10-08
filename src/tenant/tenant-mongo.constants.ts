const DATABASE_NAME_PATTERN = /^[A-Za-z0-9_-]{1,63}$/u;
const RESERVED_DATABASE_NAMES = new Set(['admin', 'config', 'local']);

export function isValidTenantMongoDatabaseName(databaseName: string): boolean {
  return (
    DATABASE_NAME_PATTERN.test(databaseName) &&
    !RESERVED_DATABASE_NAMES.has(databaseName.toLowerCase())
  );
}
