export type ConfiguredTenantStorageProvider = 'disabled' | 'memory' | 'mongodb';

/** Volatile storage is selected only when explicitly enabled in development. */
export function effectiveTenantStorageProvider(
  configuredProvider: ConfiguredTenantStorageProvider,
  isDevelopment: boolean,
): ConfiguredTenantStorageProvider {
  if (configuredProvider === 'mongodb') return 'mongodb';
  if (configuredProvider === 'memory' && isDevelopment) return 'memory';
  return 'disabled';
}
