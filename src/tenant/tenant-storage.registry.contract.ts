import type { TrustedTenantStorageContext } from './tenant-context.contract';

export const TENANT_STORAGE_TARGET_RESOLVER = Symbol('TENANT_STORAGE_TARGET_RESOLVER');

export interface TenantStorageTargetRecord {
  id: string;
  tenantId: string;
  provider: 'MONGODB';
  connectionReference: string;
  databaseName: string;
  status: 'ACTIVE' | 'INACTIVE';
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantStorageTargetResolver {
  findActivePrimaryTarget(
    context: TrustedTenantStorageContext,
    placementId: string,
  ): Promise<TenantStorageTargetRecord | null>;
}
