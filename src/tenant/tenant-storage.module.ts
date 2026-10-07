import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { ConfigService } from '../config/config.service';
import { PATIENT_REPOSITORY, TenantStoragePatientRepository } from './patient.repository';
import {
  DevelopmentTenantDatabaseRegistry,
  TENANT_DATABASE_REGISTRY,
  TENANT_STORAGE_RESOLVER,
  TenantStorageResolverService,
  UnconfiguredTenantDatabaseRegistry,
} from './tenant-storage.resolver';
import {
  InMemoryTenantPatientStorage,
  TENANT_PATIENT_STORAGE,
  UnconfiguredTenantPatientStorage,
} from './tenant-patient.storage';
import type { TenantPatientStorage } from './tenant-patient.storage';
import type { TenantDatabaseRegistry } from './tenant-storage.contract';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: TENANT_DATABASE_REGISTRY,
      inject: [ConfigService],
      useFactory: (config: ConfigService): TenantDatabaseRegistry =>
        config.isDevelopment
          ? new DevelopmentTenantDatabaseRegistry()
          : new UnconfiguredTenantDatabaseRegistry(),
    },
    TenantStorageResolverService,
    {
      provide: TENANT_STORAGE_RESOLVER,
      useExisting: TenantStorageResolverService,
    },
    {
      provide: TENANT_PATIENT_STORAGE,
      inject: [ConfigService],
      useFactory: (config: ConfigService): TenantPatientStorage =>
        config.isDevelopment
          ? new InMemoryTenantPatientStorage()
          : new UnconfiguredTenantPatientStorage(),
    },
    TenantStoragePatientRepository,
    {
      provide: PATIENT_REPOSITORY,
      useExisting: TenantStoragePatientRepository,
    },
  ],
  exports: [PATIENT_REPOSITORY, TENANT_STORAGE_RESOLVER],
})
export class TenantStorageModule {}
